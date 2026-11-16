import { icon } from '../icons.js';
import { get, post, patch, del, ApiError } from '../api.js';
import { $, $$, html, raw, openModal, confirmBox, toast, wait, fmtNum, timeAgo, confetti } from '../ui.js';

const STATUS = (g) => !g.enabled ? ['Nonaktif', 'badge--gray', 'power'] : g.status === 'error' ? ['Error', 'badge--red', 'alert'] : ['Aktif', 'badge--mint', 'check'];

function accountCard(g, i) {
  const [label, badge, ic] = STATUS(g);
  return html`<article class="card card--hover gm-card stagger" style="--i:${i}" data-id="${g.id}">
    <div class="gm-card__top">
      <span class="tile ${g.status === 'error' ? 'tile--red' : 'tile--blue'}">${raw(icon('mail'))}</span>
      <div class="gm-card__mail" style="flex:1;min-width:0">${g.email}</div>
      <span class="badge ${badge}">${raw(icon(ic))} ${label}</span>
    </div>
    <div class="gm-card__meta">
      <span class="badge badge--blue mono">${g.host}:${g.port}</span>
      <span class="badge">${raw(icon('lock'))} App Password terenkripsi</span>
    </div>
    <div class="gm-card__stats">
      <div class="mini"><b>${fmtNum(g.sentToday)}</b><span>OTP hari ini</span></div>
      <div class="mini"><b>${fmtNum(g.sentTotal)}</b><span>Total terkirim</span></div>
      <div class="mini"><b style="font-size:14px;line-height:1.7">${timeAgo(g.lastUsedAt)}</b><span>Terakhir dipakai</span></div>
    </div>
    ${g.lastError ? html`<div class="err-line">⚠ ${g.lastError}</div>` : ''}
    <div class="gm-card__actions">
      <label class="switch" title="Aktif / nonaktif"><input type="checkbox" data-toggle ${g.enabled ? 'checked' : ''} aria-label="Aktifkan ${g.email}"><span></span></label>
      <span class="grow muted" style="font-size:12px;font-weight:700">Dicek ${timeAgo(g.lastCheckedAt)}</span>
      <button class="btn btn--sm btn--sky" data-test data-anim="spin">${raw(icon('refresh'))} Cek</button>
      <button class="btn btn--sm btn--red" data-del data-anim="shake">${raw(icon('trash'))}</button>
    </div>
  </article>`;
}

export default {
  id: 'gmail', title: 'Gmail', icon: 'mail',
  render(root, ctx) {
    root.innerHTML = html`
      <div class="section-title"><span class="pill-label">OTP Sender</span></div>
      <div class="section-title" style="margin-top:0">
        <h1>Gmail <em>Pengirim OTP</em></h1><span class="grow"></span>
        <button class="btn btn--blue btn--skew" id="add" data-anim="plus"><span>${raw(icon('plus'))} Tambah Gmail</span></button>
      </div>
      <div class="notice-box notice-box--blue" style="margin-bottom:18px">${raw(icon('info'))}<span>OTP dikirim bergiliran dari Gmail yang <b>aktif</b> (yang paling jarang dipakai hari ini dulu). Kalau satu gagal, otomatis pindah ke berikutnya. Batas aman ±480 email/hari per akun.</span></div>
      <div class="cards-2" id="list"><div class="skel" style="height:230px;border-radius:20px"></div><div class="skel" style="height:230px;border-radius:20px"></div></div>`.toString();

    let accounts = [];
    const list = $('#list', root);

    async function load() {
      try {
        accounts = (await get('/admin/gmail')).accounts;
        paint();
      } catch (e) { toast(e.message, 'err'); }
    }
    function paint() {
      list.innerHTML = accounts.length ? accounts.map(accountCard).join('') : html`
        <div class="empty" style="grid-column:1/-1"><span class="tile tile--red bounce">${raw(icon('mail'))}</span>
          <h4>Belum ada Gmail pengirim</h4><p class="muted">Tambahkan Gmail + App Password supaya OTP bisa terkirim ke pengguna.</p>
          <button class="btn btn--blue" data-open-add data-anim="plus">${raw(icon('plus'))} Tambah Gmail pertama</button></div>`.toString();
    }

    /* ───── Modal Tambah Gmail: isi → loading cek → sukses / error ───── */
    function openAdd() {
      const m = openModal({
        title: 'Tambah Gmail', icon: 'mail',
        body: html`
          <details class="how"><summary>📖 Cara dapat App Password</summary>
            <ol><li>Buka <b>myaccount.google.com</b> → Keamanan</li><li>Aktifkan <b>Verifikasi 2 Langkah</b></li><li>Cari <b>Sandi aplikasi</b> → buat baru</li><li>Salin 16 karakter (spasi boleh)</li></ol></details>
          <form id="gf" novalidate>
            <div class="field"><label for="g-mail">Gmail</label><input class="input" id="g-mail" type="email" inputmode="email" autocomplete="off" placeholder="contoh@gmail.com" required></div>
            <div class="field"><label for="g-pass">App Password</label>
              <div class="input-wrap"><input class="input mono" id="g-pass" type="password" autocomplete="new-password" placeholder="xxxx xxxx xxxx xxxx" required>
                <button type="button" class="icon-btn" data-eye aria-label="Tampilkan">${raw(icon('eye'))}</button></div>
              <span class="hint">Bukan password login Gmail. Disimpan terenkripsi.</span></div>
            <div class="row">
              <div class="field"><label for="g-host">Host SMTP</label><input class="input mono" id="g-host" value="smtp.gmail.com" autocomplete="off"></div>
              <div class="field"><label for="g-port">Port</label><select class="input" id="g-port"><option value="587">587 · STARTTLS</option><option value="465">465 · SSL</option></select></div>
            </div>
          </form>
          <div id="gstate" hidden></div>`,
        foot: html`<button class="btn" data-close>Batal</button><button class="btn btn--blue" id="g-go" data-anim="zap">${raw(icon('zap'))} Cek & Simpan</button>`,
      });
      const body = m.el.querySelector('.modal__body');
      m.el.addEventListener('click', (e) => {
        if (e.target.closest('[data-eye]')) {
          const p = m.$('#g-pass'); const show = p.type === 'password';
          p.type = show ? 'text' : 'password';
          e.target.closest('[data-eye]').innerHTML = icon(show ? 'eyeoff' : 'eye');
        }
        if (e.target.closest('#g-go')) submit();
        if (e.target.closest('[data-retry]')) { m.$('#gf').hidden = false; m.$('.how').hidden = false; m.$('#gstate').hidden = true; m.setFoot(footForm()); }
      });
      m.$('#gf').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      const footForm = () => html`<button class="btn" data-close>Batal</button><button class="btn btn--blue" id="g-go" data-anim="zap">${raw(icon('zap'))} Cek & Simpan</button>`;

      const STEPS = [['server', 'Menghubungi server SMTP'], ['lock', 'Login dengan App Password'], ['shield', 'Menyimpan terenkripsi']];
      const stepsHtml = (st) => html`<div class="steps">${STEPS.map(([ic, t], i) => html`
        <div class="step ${st[i] ?? ''}"><span class="tile">${raw(st[i] === 'is-done' ? icon('check') : st[i] === 'is-fail' ? icon('x') : st[i] === 'is-active' ? '<span class="spinner" style="width:18px;height:18px;border:3px solid rgba(13,27,76,.25);border-top-color:#0d1b4c;border-radius:50%;animation:spin .7s linear infinite"></span>' : icon(ic))}</span>${t}</div>`)}</div>`;

      async function submit() {
        const email = m.$('#g-mail').value.trim(), appPassword = m.$('#g-pass').value.trim();
        const host = m.$('#g-host').value.trim(), port = +m.$('#g-port').value;
        const form = m.$('#gf');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return toast('Isi alamat Gmail yang benar', 'err'); }
        if (appPassword.replace(/\s/g, '').length < 12) { form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); return toast('App Password belum lengkap (16 karakter)', 'err'); }

        form.hidden = true; m.$('.how').hidden = true;
        const stEl = m.$('#gstate'); stEl.hidden = false;
        m.setFoot(html`<button class="btn" disabled>Memeriksa…</button>`);
        const st = ['is-active', '', ''];
        stEl.innerHTML = stepsHtml(st).toString();
        // animasi langkah 1 → 2 berjalan selagi menunggu respons server
        const tick = setTimeout(() => { st[0] = 'is-done'; st[1] = 'is-active'; stEl.innerHTML = stepsHtml(st).toString(); }, 1100);
        const t0 = Date.now();
        try {
          const r = await post('/admin/gmail', { email, appPassword, host, port });
          clearTimeout(tick);
          await wait(Math.max(0, 1500 - (Date.now() - t0)));
          st[0] = st[1] = 'is-done'; st[2] = 'is-active'; stEl.innerHTML = stepsHtml(st).toString();
          await wait(650);
          st[2] = 'is-done';
          stEl.innerHTML = html`<div class="result result--ok"><div class="big"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
            <h4>Berhasil tersambung!</h4><p class="muted"><b>${r.account.email}</b> sudah aktif sebagai pengirim OTP.</p></div>`.toString();
          confetti(stEl.querySelector('.result'));
          m.setFoot(html`<button class="btn btn--mint" data-close data-anim="bounce">${raw(icon('check'))} Selesai</button>`);
          toast('Gmail ditambahkan', 'ok', r.account.email);
          load(); ctx.refreshStats();
        } catch (e) {
          clearTimeout(tick);
          await wait(Math.max(0, 1300 - (Date.now() - t0)));
          const code = e instanceof ApiError ? e.code : null;
          const failAt = code === 'unreachable' || code === 'tls' ? 0 : code === 'duplicate' ? 0 : 1;
          const s2 = ['', '', '']; for (let i = 0; i < failAt; i++) s2[i] = 'is-done'; s2[failAt] = 'is-fail';
          stEl.innerHTML = (stepsHtml(s2).toString()) + html`<div class="result result--err" style="padding-top:2px"><h4>${code === 'bad_password' ? 'App Password salah' : code === 'duplicate' ? 'Sudah terdaftar' : 'Gagal tersambung'}</h4>
            <p class="muted" style="font-weight:600">${e.message}</p></div>`.toString();
          m.setFoot(html`<button class="btn" data-close>Tutup</button><button class="btn btn--yellow" data-retry data-anim="spin">${raw(icon('refresh'))} Coba lagi</button>`);
        }
      }
    }

    root.addEventListener('click', async (e) => {
      if (e.target.closest('#add, [data-open-add]')) return openAdd();
      const card = e.target.closest('[data-id]');
      if (!card) return;
      const id = card.dataset.id, g = accounts.find((x) => x.id === id);
      if (e.target.closest('[data-test]')) {
        const b = e.target.closest('[data-test]'); b.classList.add('is-loading');
        try { await post(`/admin/gmail/${id}/test`); toast('Login SMTP berhasil', 'ok', g.email); }
        catch (x) { toast(x.message, 'err', g.email); }
        finally { b.classList.remove('is-loading'); load(); ctx.refreshStats(); }
      }
      if (e.target.closest('[data-del]') && await confirmBox({ title: 'Hapus Gmail?', text: `${g.email} tidak akan dipakai lagi untuk mengirim OTP.`, ok: 'Hapus', danger: true, ic: 'trash' })) {
        try { await del(`/admin/gmail/${id}`); toast('Gmail dihapus', 'ok'); load(); ctx.refreshStats(); } catch (x) { toast(x.message, 'err'); }
      }
    });
    root.addEventListener('change', async (e) => {
      const t = e.target.closest('[data-toggle]'); if (!t) return;
      const id = t.closest('[data-id]').dataset.id;
      try { await patch(`/admin/gmail/${id}`, { enabled: t.checked }); toast(t.checked ? 'Gmail diaktifkan' : 'Gmail dinonaktifkan', 'ok'); load(); ctx.refreshStats(); }
      catch (x) { t.checked = !t.checked; toast(x.message, 'err'); }
    });

    ctx.onReload(load);
    load();
    return () => {};
  },
};
