import { icon } from '../icons.js';
import { get, post, patch, del, apiBytesProgress } from '../api.js';
import { Sha256 } from '../sha256.js';
import { $, html, raw, confirmBox, toast, timeAgo, fmtDateTime } from '../ui.js';

const CHUNK = 1024 * 1024; // 1 MB per potongan: fungsi Vercel hanya hidup 15 dtk, jadi potongan 4 MB sering timeout di koneksi HP
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

export default {
  id: 'rilis', title: 'Rilis', icon: 'rocket',
  render(root, ctx) {
    root.innerHTML = html`
      <div class="section-title"><span class="pill-label">Update aplikasi</span></div>
      <div class="section-title" style="margin-top:0"><h1>Rilis & <em>Update Wajib</em></h1></div>

      <div class="cols cols--2">
        <section class="card stagger" style="--i:1">
          <div class="card__head"><span class="tile tile--blue">${raw(icon('rocket'))}</span><div class="grow"><div class="card__title">Terbitkan versi baru</div><div class="card__sub">Unggah APK terbaru. Aplikasi lama akan menampilkan layar update wajib.</div></div></div>
          <div class="row">
            <div class="field"><label for="ver">Versi baru</label><input class="input mono" id="ver" placeholder="mis. 1.0.2" inputmode="decimal"></div>
            <div class="field"><span class="label">APK</span><input class="input" id="apk" type="file" accept=".apk,application/vnd.android.package-archive"></div>
          </div>
          <div class="field"><label for="notes">Catatan update terbaru <span class="hint" style="text-transform:none">(satu poin per baris)</span></label>
            <textarea class="input" id="notes" maxlength="2000" placeholder="Foto profil dari galeri&#10;Panggilan suara & video&#10;Perbaikan bug"></textarea></div>
          <div class="field"><label for="ext">Atau link unduhan luar (opsional)</label><input class="input" id="ext" placeholder="https://github.com/.../app-release.apk"><span class="hint">Dipakai kalau kamu tidak mengunggah APK di sini.</span></div>
          <label class="field" style="grid-auto-flow:column;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--card-2);border:var(--bw) solid var(--ink);border-radius:14px;cursor:pointer">
            <span><b>Wajib update</b><br><span class="hint">Versi di bawah ini tidak bisa dipakai sampai update</span></span>
            <span class="switch"><input type="checkbox" id="force" checked><span></span></span></label>
          <div id="ferr" role="alert" style="display:none;margin-top:14px;padding:10px 12px;border:var(--bw) solid var(--ink);border-radius:12px;background:#ffd9da;color:#7a0b10;font-weight:800"></div>
          <button class="btn btn--blue btn--block" id="go" style="margin-top:16px" data-anim="fly">${raw(icon('up'))} Unggah & Terbitkan</button>
        </section>

        <section class="card stagger" style="--i:2;align-self:start">
          <div class="card__head"><span class="tile tile--sky">${raw(icon('phone'))}</span><div class="card__title">Pratinjau di HP</div></div>
          <div class="phone"><div class="phone__screen"><div class="phone__bar"></div><div id="pv"></div></div></div>
          <p class="hint center" style="margin-top:12px">Begini layar update wajib di aplikasi.</p>
        </section>
      </div>

      <div class="wave"></div>
      <div class="section-title" style="margin-top:0"><span class="pill-label">Riwayat rilis</span></div>
      <div class="list" id="hist"><div class="skel" style="height:90px;border-radius:20px"></div></div>`.toString();

    const el = (s) => $(s, root);
    let busy = false;

    function preview() {
      const v = el('#ver').value.trim() || '1.0.2';
      const lines = el('#notes').value.split('\n').map((s) => s.trim()).filter(Boolean);
      el('#pv').innerHTML = html`<div class="pv pv--critical"><div class="tag">UPDATE ${el('#force').checked ? 'WAJIB' : 'TERSEDIA'}</div>
        <h5>Versi ${v}</h5><p>Catatan update terbaru:</p>
        <ul style="margin:6px 0 0 16px;padding:0;font-size:12px">${lines.length ? lines.map((l) => html`<li>${l}</li>`) : html`<li>…</li>`}</ul>
        <div style="margin-top:10px;padding:8px;text-align:center;font-weight:800;font-size:12px;color:#fff;background:#2f6bff;border:3px solid #0d1b4c;border-radius:10px">Perbarui Sekarang</div></div>`.toString();
    }
    ['#ver', '#notes', '#force'].forEach((s) => el(s).addEventListener('input', preview));
    preview();

    const ferr = (msg) => { const b = el('#ferr'); b.textContent = msg || ''; b.style.display = msg ? '' : 'none'; };
    const bad = (msg, sel) => { ferr(msg); toast(msg, 'err'); if (sel) el(sel)?.focus(); };

    /** Overlay layar penuh: persen 0–100, tahap yang sedang berjalan, lalu hasil akhir (sukses / gagal + coba lagi). */
    function openProgress(version) {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-live="polite" style="text-align:center">
        <div class="modal__head"><span class="tile tile--blue">${icon('rocket')}</span><h3 data-t></h3></div>
        <div class="modal__body">
          <div data-pct style="font-size:68px;font-weight:900;line-height:1;font-variant-numeric:tabular-nums">0%</div>
          <div style="height:20px;border:var(--bw) solid var(--ink);border-radius:12px;overflow:hidden;background:var(--card-2);margin:16px 0 12px"><div data-bar style="height:100%;width:0;background:#2f6bff;transition:width .2s linear"></div></div>
          <div data-s style="font-weight:800">Menyiapkan…</div>
          <div class="hint" data-h style="margin-top:6px">Jangan tutup atau tinggalkan halaman ini sampai selesai.</div>
        </div>
        <div class="modal__foot" data-f style="justify-content:center"></div></div>`;
      document.body.append(ov);
      document.body.style.overflow = 'hidden';
      const q = (s) => ov.querySelector(s);
      q('[data-t]').textContent = `Menerbitkan versi ${version}`;
      return {
        set(p, status, hint) {
          const pct = Math.max(0, Math.min(100, Math.round(p)));
          q('[data-pct]').textContent = `${pct}%`;
          q('[data-bar]').style.width = `${pct}%`;
          if (status) q('[data-s]').textContent = status;
          if (hint !== undefined) q('[data-h]').textContent = hint;
        },
        close() { ov.remove(); if (!document.querySelector('.overlay')) document.body.style.overflow = ''; },
        finish(kind, status, hint, buttons) {
          q('[data-s]').textContent = status;
          q('[data-s]').style.color = kind === 'err' ? 'var(--red)' : '';
          q('[data-h]').textContent = hint || '';
          q('[data-bar]').style.background = kind === 'err' ? 'var(--red)' : 'var(--mint)';
          const f = q('[data-f]'); f.textContent = '';
          for (const b of buttons) {
            const btn = document.createElement('button');
            btn.className = `btn ${b.cls || ''}`; btn.textContent = b.label; btn.onclick = b.onClick;
            f.append(btn);
          }
        },
      };
    }

    async function sendChunk(idx, buf, onProgress, tries = 4) {
      let last;
      for (let a = 1; a <= tries; a++) {
        try { return await apiBytesProgress(`/admin/releases/chunk?idx=${idx}`, buf, onProgress); }
        catch (e) {
          last = e;
          if (e.status && e.status < 500) throw e; // 4xx jangan diulang; status 0 (jaringan) dan 5xx diulang
          onProgress(0, 1);
          await new Promise((r) => setTimeout(r, 800 * a));
        }
      }
      throw last;
    }

    async function publish(skipConfirm = false) {
      if (busy) return;
      ferr('');
      const version = el('#ver').value.trim();
      if (!/^\d+(\.\d+){0,3}$/.test(version)) return bad('Versi harus seperti 1.0.2', '#ver');
      const file = el('#apk').files[0];
      const ext = el('#ext').value.trim();
      if (!file && !ext) return bad('Pilih file APK atau isi link unduhan dulu.', '#apk');
      if (file && !/\.apk$/i.test(file.name)) return bad('File harus berformat .apk', '#apk');
      if (!file && !/^https:\/\//i.test(ext)) return bad('Link unduhan harus diawali https://', '#ext');
      const force = el('#force').checked;
      const notes = el('#notes').value.trim();

      if (!skipConfirm && !(await confirmBox({
        title: `Terbitkan versi ${version}?`,
        text: force ? 'Semua pengguna dengan versi lebih lama akan dipaksa update.' : 'Pengguna akan melihat pemberitahuan update.',
        ok: 'Terbitkan', ic: 'rocket',
      }))) return;

      busy = true;
      const btn = el('#go'); // diambil dari DOM, BUKAN e.currentTarget (null setelah await -> dulu bikin tombol macet)
      btn.classList.add('is-loading');
      const ov = openProgress(version);
      try {
        ov.set(0, 'Memeriksa nomor versi…');
        const { releases } = await get('/admin/releases');
        if (releases.some((r) => r.version === version)) throw new Error(`Versi ${version} sudah pernah dirilis. Pakai nomor versi yang baru.`);

        const parts = []; let sha = null;
        if (file) {
          const hash = new Sha256();
          const total = Math.ceil(file.size / CHUNK);
          for (let i = 0; i < total; i++) {
            const start = i * CHUNK;
            const piece = file.slice(start, Math.min(file.size, start + CHUNK));
            const buf = await piece.arrayBuffer();
            hash.update(new Uint8Array(buf));
            const at = (frac) => ((start + frac * piece.size) / file.size) * 96;
            ov.set(at(0), `Mengunggah ke server… bagian ${i + 1} dari ${total} (${fmtSize(file.size)})`);
            const r = await sendChunk(i, buf, (loaded, tot) => ov.set(at(tot ? loaded / tot : 0)));
            parts.push({ url: r.url, size: r.size });
          }
          sha = hash.hex();
        }
        ov.set(97, 'Menerbitkan ke semua pengguna…');
        await post('/admin/releases', { version, notes, force, parts, sha256: sha, externalUrl: file ? null : ext });
        ov.set(100, 'Selesai!');
        toast(`Versi ${version} terbit`, 'ok', 'Aplikasi akan menampilkan update saat dibuka');
        ov.finish('ok', `Versi ${version} sudah terbit ke semua pengguna`,
          'Pengguna melihat layar update saat membuka aplikasi (dicek otomatis tiap beberapa menit).',
          [{ label: 'Selesai', cls: 'btn--blue', onClick: () => ov.close() }]);
        el('#apk').value = '';
        loadHistory();
      } catch (x) {
        ferr(x.message);
        ov.finish('err', x.message || 'Gagal menerbitkan.', 'Belum ada yang terbit. Perbaiki lalu coba lagi.', [
          { label: 'Tutup', onClick: () => ov.close() },
          { label: 'Coba lagi', cls: 'btn--blue', onClick: () => { ov.close(); publish(true); } },
        ]);
      } finally { busy = false; btn.classList.remove('is-loading'); }
    }
    el('#go').onclick = () => publish(false);

    async function loadHistory() {
      try {
        const { releases } = await get('/admin/releases');
        el('#hist').innerHTML = releases.length ? releases.map((r, i) => html`
          <article class="card card--hover notice-row stagger" style="--i:${Math.min(i, 6)}" data-id="${r.id}">
            <div class="notice-row__top"><span class="tile tile--blue">${raw(icon('rocket'))}</span><h4>Versi ${r.version}</h4>
              <span class="badge ${r.active ? 'badge--mint' : 'badge--gray'}">${r.active ? 'Aktif' : 'Dimatikan'}</span>
              <label class="switch" title="Aktif / nonaktif"><input type="checkbox" data-toggle ${r.active ? 'checked' : ''} aria-label="Aktifkan ${r.version}"><span></span></label>
              <button class="btn btn--sm btn--red" data-del aria-label="Hapus" data-anim="shake">${raw(icon('trash'))}</button></div>
            ${r.notes ? html`<p style="white-space:pre-line">${r.notes}</p>` : ''}
            <div class="chips">${r.force ? html`<span class="badge badge--red">Wajib update</span>` : html`<span class="badge">Opsional</span>`}
              <span class="badge mono">${r.parts ? `${fmtSize(r.size)} · ${r.parts} potongan` : 'link luar'}</span>
              <span class="badge mono">${timeAgo(r.createdAt)}</span><span class="badge">${fmtDateTime(r.createdAt)}</span></div>
          </article>`.toString()).join('')
          : `<div class="empty"><span class="tile tile--blue bounce">${icon('rocket')}</span><h4>Belum ada rilis</h4><p class="muted">Rilis yang kamu terbitkan akan tercatat di sini.</p></div>`;
      } catch (x) { toast(x.message, 'err'); }
    }
    el('#hist').addEventListener('click', async (e) => {
      const card = e.target.closest('[data-id]'); if (!card || !e.target.closest('[data-del]')) return;
      if (!(await confirmBox({ title: 'Hapus rilis?', text: 'File APK-nya ikut dihapus dari server.', ok: 'Hapus', danger: true, ic: 'trash' }))) return;
      try { await del(`/admin/releases/${card.dataset.id}`); toast('Rilis dihapus', 'ok'); loadHistory(); } catch (x) { toast(x.message, 'err'); }
    });
    el('#hist').addEventListener('change', async (e) => {
      const t = e.target.closest('[data-toggle]'); if (!t) return;
      try { await patch(`/admin/releases/${t.closest('[data-id]').dataset.id}`, { active: t.checked }); toast(t.checked ? 'Rilis diaktifkan' : 'Rilis dinonaktifkan', 'ok'); loadHistory(); }
      catch (x) { t.checked = !t.checked; toast(x.message, 'err'); }
    });

    ctx.onReload(loadHistory);
    loadHistory();
    return () => {};
  },
};
