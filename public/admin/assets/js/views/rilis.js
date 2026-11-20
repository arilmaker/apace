import { icon } from '../icons.js';
import { get, post, patch, del, apiBytes } from '../api.js';
import { $, html, raw, confirmBox, toast, timeAgo, fmtDateTime } from '../ui.js';

const CHUNK = 4 * 1024 * 1024 - 1024; // sedikit di bawah 4 MB (batas body Vercel ~4,5 MB)
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
          <div id="prog" style="display:none;margin-top:14px">
            <div style="height:14px;border:var(--bw) solid var(--ink);border-radius:10px;overflow:hidden;background:var(--card-2)"><div id="bar" style="height:100%;width:0;background:#2f6bff;transition:width .2s"></div></div>
            <div class="hint" id="ptxt" style="margin-top:6px">Menyiapkan…</div>
          </div>
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

    const setProg = (p, text) => { el('#prog').style.display = ''; el('#bar').style.width = `${Math.round(p * 100)}%`; el('#ptxt').textContent = text; };

    async function sendChunk(idx, blob, tries = 3) {
      let last;
      for (let a = 1; a <= tries; a++) {
        try { return await apiBytes(`/admin/releases/chunk?idx=${idx}`, blob); }
        catch (e) { last = e; if (e.status && e.status < 500 && e.status !== 0) throw e; await new Promise((r) => setTimeout(r, 800 * a)); }
      }
      throw last;
    }

    el('#go').onclick = async (e) => {
      if (busy) return;
      const version = el('#ver').value.trim();
      if (!/^\d+(\.\d+){0,3}$/.test(version)) { toast('Versi harus seperti 1.0.2', 'err'); el('#ver').focus(); return; }
      const file = el('#apk').files[0];
      const ext = el('#ext').value.trim();
      if (!file && !ext) { toast('Pilih file APK atau isi link unduhan', 'err'); return; }
      if (file && !/\.apk$/i.test(file.name)) { toast('File harus berformat .apk', 'err'); return; }
      if (!(await confirmBox({ title: `Terbitkan versi ${version}?`, text: el('#force').checked ? 'Semua pengguna dengan versi lebih lama akan dipaksa update.' : 'Pengguna akan melihat pemberitahuan update.', ok: 'Terbitkan', ic: 'rocket' }))) return;

      busy = true; const btn = e.currentTarget; btn.classList.add('is-loading');
      try {
        const parts = []; let sha = null;
        if (file) {
          setProg(0, 'Menghitung sidik jari file…');
          sha = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
          const total = Math.ceil(file.size / CHUNK);
          for (let i = 0; i < total; i++) {
            const piece = file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK));
            setProg(i / total, `Mengunggah potongan ${i + 1} dari ${total} (${fmtSize(file.size)})`);
            const r = await sendChunk(i, piece);
            parts.push({ url: r.url, size: r.size });
          }
          setProg(1, 'Menyimpan rilis…');
        }
        await post('/admin/releases', {
          version, notes: el('#notes').value.trim(), force: el('#force').checked,
          parts, sha256: sha, externalUrl: file ? null : ext,
        });
        toast(`Versi ${version} terbit`, 'ok', 'Aplikasi akan menampilkan update saat dibuka');
        el('#apk').value = ''; el('#prog').style.display = 'none';
        loadHistory();
      } catch (x) { toast(x.message, 'err'); setProg(0, 'Gagal. Coba lagi.'); }
      finally { busy = false; btn.classList.remove('is-loading'); }
    };

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
