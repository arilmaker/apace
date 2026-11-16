import { icon } from '../icons.js';
import { get, post, patch, put, del } from '../api.js';
import { $, $$, html, raw, confirmBox, toast, timeAgo, fmtDateTime, wait } from '../ui.js';

const KINDS = [
  { v: 'update', label: 'Update', ic: 'rocket', sev: 'info', title: 'Update baru tersedia 🚀', body: 'Versi terbaru R1ZCHATID sudah rilis dengan perbaikan bug dan peningkatan performa. Perbarui aplikasi sekarang.' },
  { v: 'maintenance', label: 'Server', ic: 'wrench', sev: 'warning', title: 'Server sedang maintenance 🛠️', body: 'Kami sedang merapikan server. Pesan mungkin tertunda sebentar. Terima kasih sudah bersabar!' },
  { v: 'feature', label: 'Fitur Baru', ic: 'sparkles', sev: 'info', title: 'Fitur baru hadir ✨', body: 'Coba fitur terbaru kami di menu pengaturan. Ceritakan pendapatmu!' },
  { v: 'info', label: 'Info', ic: 'info', sev: 'info', title: 'Info penting', body: '' },
  { v: 'warning', label: 'Peringatan', ic: 'alert', sev: 'warning', title: 'Waspada penipuan ⚠️', body: 'Jangan bagikan kode OTP kepada siapa pun, termasuk yang mengaku dari R1ZCHATID.' },
];
const SEV = [{ v: 'info', label: 'Biasa' }, { v: 'warning', label: 'Penting' }, { v: 'critical', label: 'Kritis' }];
const SERVER = [
  { v: 'ok', label: 'Normal', ic: 'check', msg: '' },
  { v: 'degraded', label: 'Gangguan', ic: 'alert', msg: 'Sebagian fitur mungkin lambat. Kami sedang menangani.' },
  { v: 'maintenance', label: 'Maintenance', ic: 'wrench', msg: 'Server sedang dirawat, kembali sebentar lagi.' },
  { v: 'down', label: 'Down', ic: 'power', msg: 'Server sedang tidak bisa diakses.' },
];
const DUR = [['', 'Sampai dimatikan'], ['6', '6 jam'], ['24', '24 jam'], ['72', '3 hari'], ['168', '7 hari']];
const kindOf = (v) => KINDS.find((k) => k.v === v) ?? KINDS[3];

export default {
  id: 'peringatan', title: 'Peringatan', icon: 'megaphone',
  render(root, ctx) {
    root.innerHTML = html`
      <div class="section-title"><span class="pill-label">Broadcast</span></div>
      <div class="section-title" style="margin-top:0"><h1>Peringatan & <em>Update</em></h1></div>

      <section class="card stagger" style="--i:1">
        <div class="card__head"><span class="tile tile--cyan">${raw(icon('server'))}</span><div class="grow"><div class="card__title">Status Server</div><div class="card__sub">Pengguna melihat ini di aplikasi (server baik / tidak)</div></div></div>
        <div class="server-tiles" id="srv">${SERVER.map((s) => html`<button class="tile-btn" data-v="${s.v}" aria-pressed="false" data-anim="bounce">${raw(icon(s.ic))}${s.label}</button>`)}</div>
        <div class="field" style="margin:14px 0 0"><label for="srvmsg">Pesan status (opsional)</label><input class="input" id="srvmsg" maxlength="300" placeholder="mis. Perbaikan selesai sekitar 30 menit lagi"></div>
        <button class="btn btn--blue" id="srvsave" style="margin-top:14px" data-anim="zap">${raw(icon('check'))} Simpan Status</button>
      </section>

      <div class="cols cols--2" style="margin-top:20px">
        <section class="card stagger" style="--i:2">
          <div class="card__head"><span class="tile tile--pink">${raw(icon('megaphone'))}</span><div class="grow"><div class="card__title">Buat Peringatan</div><div class="card__sub">Muncul sebagai kartu / banner di aplikasi Flutter</div></div></div>
          <div class="field"><span class="label">Jenis</span><div class="chips" id="kinds">${KINDS.map((k) => html`<button type="button" class="chip" data-k="${k.v}" aria-pressed="${k.v === 'update'}">${raw(icon(k.ic, 'ico" style="width:16px;height:16px'))} ${k.label}</button>`)}</div></div>
          <div class="field"><label for="t">Judul</label><input class="input" id="t" maxlength="80" placeholder="Judul singkat"></div>
          <div class="field"><label for="b">Isi pesan <span id="cnt" class="muted" style="text-transform:none">0/1000</span></label><textarea class="input" id="b" maxlength="1000" placeholder="Tulis detail untuk pengguna…"></textarea></div>
          <div class="field"><span class="label">Tingkat</span><div class="chips" id="sevs">${SEV.map((s) => html`<button type="button" class="chip ${s.v === 'critical' ? 'chip--red' : s.v === 'warning' ? 'chip--yellow' : ''}" data-s="${s.v}" aria-pressed="${s.v === 'info'}">${s.label}</button>`)}</div></div>
          <div class="row"><div class="field"><label for="d">Tampil selama</label><select class="input" id="d">${DUR.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
            <div class="field" id="verbox"><label for="mv">Versi minimum</label><input class="input mono" id="mv" placeholder="mis. 1.2.0" inputmode="decimal"></div></div>
          <label class="field" id="forcebox" style="grid-auto-flow:column;justify-content:space-between;align-items:center;padding:12px 14px;background:var(--card-2);border:var(--bw) solid var(--ink);border-radius:14px;cursor:pointer">
            <span><b>Wajib update</b><br><span class="hint">Aplikasi di bawah versi minimum harus update dulu</span></span>
            <span class="switch"><input type="checkbox" id="f"><span></span></span></label>
          <button class="btn btn--blue btn--block btn--skew send-btn" id="send" style="margin-top:16px" data-anim="fly"><span>${raw(icon('send'))} Kirim Peringatan</span></button>
        </section>

        <section class="card stagger" style="--i:3;align-self:start">
          <div class="card__head"><span class="tile tile--sky">${raw(icon('phone'))}</span><div class="card__title">Pratinjau di HP</div></div>
          <div class="phone"><div class="phone__screen"><div class="phone__bar"></div><div id="pv"></div></div></div>
          <p class="hint center" style="margin-top:12px">Begini kira-kira tampilannya untuk pengguna.</p>
        </section>
      </div>

      <div class="wave"></div>
      <div class="section-title" style="margin-top:0"><span class="pill-label">Riwayat</span></div>
      <div class="list" id="hist"><div class="skel" style="height:90px;border-radius:20px"></div></div>`.toString();

    const f = { kind: 'update', severity: 'info', server: 'ok' };
    const el = (s) => $(s, root);

    /* ── status server ── */
    function paintServer() { $$('#srv [data-v]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === f.server))); }
    el('#srv').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      f.server = b.dataset.v; paintServer();
      const cur = el('#srvmsg').value.trim();
      if (!cur || SERVER.some((s) => s.msg === cur)) el('#srvmsg').value = SERVER.find((s) => s.v === f.server).msg;
    });
    el('#srvsave').onclick = async (e) => {
      const b = e.currentTarget; b.classList.add('is-loading');
      try { await put('/admin/server-status', { status: f.server, message: el('#srvmsg').value.trim() }); toast('Status server diperbarui', 'ok', SERVER.find((s) => s.v === f.server).label); ctx.refreshStats(); }
      catch (x) { toast(x.message, 'err'); } finally { b.classList.remove('is-loading'); }
    };

    /* ── composer ── */
    function preview() {
      const t = el('#t').value.trim() || 'Judul peringatan';
      const b = el('#b').value.trim() || 'Isi pesan akan tampil di sini.';
      const k = kindOf(f.kind);
      el('#pv').innerHTML = html`<div class="pv pv--${f.severity === 'info' ? '' : f.severity}"><div class="tag">${k.label.toUpperCase()}${el('#f').checked ? ' · WAJIB' : ''}</div><h5>${t}</h5><p>${b}</p>
        ${el('#f').checked ? html`<div style="margin-top:10px;padding:8px;text-align:center;font-weight:800;font-size:12px;color:#fff;background:#2f6bff;border:3px solid #0d1b4c;border-radius:10px">Update Sekarang</div>` : ''}</div>`.toString();
      el('#cnt').textContent = `${el('#b').value.length}/1000`;
      const isUpd = f.kind === 'update';
      el('#verbox').style.display = el('#forcebox').style.display = isUpd ? '' : 'none';
    }
    function setKind(v, fill = true) {
      f.kind = v; const k = kindOf(v);
      $$('#kinds [data-k]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === v)));
      if (fill) { el('#t').value = k.title; el('#b').value = k.body; setSev(k.sev); }
      preview();
    }
    function setSev(v) { f.severity = v; $$('#sevs [data-s]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === v))); preview(); }
    el('#kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) setKind(b.dataset.k); });
    el('#sevs').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) setSev(b.dataset.s); });
    ['#t', '#b', '#f'].forEach((s) => el(s).addEventListener('input', preview));

    el('#send').onclick = async (e) => {
      const btn = e.currentTarget;
      const title = el('#t').value.trim();
      if (title.length < 3) { toast('Judul minimal 3 huruf', 'err'); el('#t').focus(); return; }
      const force = f.kind === 'update' && el('#f').checked;
      if (force && !el('#mv').value.trim()) { toast('Isi versi minimum untuk wajib update', 'err'); el('#mv').focus(); return; }
      if (f.severity === 'critical' && !(await confirmBox({ title: 'Kirim peringatan KRITIS?', text: 'Semua pengguna akan melihatnya dengan tampilan merah mencolok.', ok: 'Kirim', ic: 'alert' }))) return;
      btn.classList.add('is-sending', 'is-loading');
      try {
        await post('/admin/notices', {
          kind: f.kind, severity: f.severity, title, body: el('#b').value.trim(),
          forceUpdate: force, minVersion: f.kind === 'update' ? el('#mv').value.trim() || null : null,
          expiresInHours: el('#d').value ? +el('#d').value : null,
        });
        await wait(500);
        toast('Peringatan terkirim ke pengguna', 'ok', 'Tampil saat aplikasi memeriksa /app/notice');
        loadHistory();
      } catch (x) { toast(x.message, 'err'); }
      finally { btn.classList.remove('is-sending', 'is-loading'); }
    };

    /* ── riwayat ── */
    async function loadHistory() {
      try {
        const { notices, server } = await get('/admin/notices');
        f.server = server.status; el('#srvmsg').value = server.message ?? ''; paintServer();
        el('#hist').innerHTML = notices.length ? notices.map((n, i) => {
          const k = kindOf(n.kind), expired = n.expiresAt && new Date(n.expiresAt) < new Date();
          return html`<article class="card card--hover notice-row stagger" style="--i:${Math.min(i, 6)}" data-id="${n.id}">
            <div class="notice-row__top"><span class="tile ${n.severity === 'critical' ? 'tile--red' : n.severity === 'warning' ? 'tile--yellow' : 'tile--blue'}">${raw(icon(k.ic))}</span>
              <h4>${n.title}</h4>
              <span class="badge ${n.active && !expired ? 'badge--mint' : 'badge--gray'}">${n.active && !expired ? 'Tampil' : expired ? 'Kedaluwarsa' : 'Dimatikan'}</span>
              <label class="switch" title="Tampilkan / sembunyikan"><input type="checkbox" data-toggle ${n.active ? 'checked' : ''} aria-label="Tampilkan ${n.title}"><span></span></label>
              <button class="btn btn--sm btn--red" data-del aria-label="Hapus" data-anim="shake">${raw(icon('trash'))}</button></div>
            ${n.body ? html`<p>${n.body}</p>` : ''}
            <div class="chips"><span class="badge">${k.label}</span>${n.forceUpdate ? html`<span class="badge badge--red">Wajib update ≥ ${n.minVersion}</span>` : ''}
              <span class="badge mono">${timeAgo(n.createdAt)}</span>${n.expiresAt ? html`<span class="badge">sampai ${fmtDateTime(n.expiresAt)}</span>` : ''}</div>
          </article>`.toString();
        }).join('') : `<div class="empty"><span class="tile tile--pink bounce">${icon('megaphone')}</span><h4>Belum ada peringatan</h4><p class="muted">Peringatan yang kamu kirim akan tercatat di sini.</p></div>`;
      } catch (x) { toast(x.message, 'err'); }
    }
    el('#hist').addEventListener('click', async (e) => {
      const card = e.target.closest('[data-id]'); if (!card || !e.target.closest('[data-del]')) return;
      if (!(await confirmBox({ title: 'Hapus peringatan?', text: 'Peringatan ini hilang dari aplikasi dan riwayat.', ok: 'Hapus', danger: true, ic: 'trash' }))) return;
      try { await del(`/admin/notices/${card.dataset.id}`); toast('Peringatan dihapus', 'ok'); loadHistory(); } catch (x) { toast(x.message, 'err'); }
    });
    el('#hist').addEventListener('change', async (e) => {
      const t = e.target.closest('[data-toggle]'); if (!t) return;
      try { await patch(`/admin/notices/${t.closest('[data-id]').dataset.id}`, { active: t.checked }); toast(t.checked ? 'Ditampilkan' : 'Disembunyikan', 'ok'); loadHistory(); }
      catch (x) { t.checked = !t.checked; toast(x.message, 'err'); }
    });

    setKind('update'); paintServer();
    ctx.onReload(loadHistory);
    loadHistory();
    return () => {};
  },
};
