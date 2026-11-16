import { CATEGORIES } from '../config.js';
import { icon } from '../icons.js';
import { get, post } from '../api.js';
import { $, $$, html, raw, openModal, confirmBox, toast, timeAgo, remaining, fmtDateTime, withLoading } from '../ui.js';

const catLabel = (v) => CATEGORIES.find((c) => c.v === v);
const LEVEL = { high: ['TINGGI', 'badge--red'], medium: ['SEDANG', 'badge--yellow'], low: ['RENDAH', 'badge--blue'] };
const STATE = {
  permanent: ['Nonaktif Permanen', 'badge--red', 'ban'],
  disabled: ['Nonaktif Sementara', 'badge--yellow', 'clock'],
  limited: ['Batas Waktu', 'badge--blue', 'timer'],
  ok: ['Normal', 'badge--mint', 'check'],
};
const LOG = { limit: ['Batas waktu kirim', 'timer', 'tile--yellow'], disable_spam: ['Nonaktif (spam)', 'ban', 'tile--red'], disable_permanent: ['Nonaktif permanen', 'ban', 'tile--red'], restore: ['Dipulihkan', 'undo', 'tile--mint'] };

const nameOf = (u) => u.displayName || (u.username ? `@${u.username}` : u.email.split('@')[0]);

function userCard(u, i, mode) {
  const [sl, sb, si] = STATE[u.state] ?? STATE.ok;
  const lvl = LEVEL[u.level];
  const cat = catLabel(u.category);
  return html`<article class="card card--hover user-card stagger" style="--i:${Math.min(i, 8)}" data-uid="${u.id}">
    <div class="user-card__top">
      <span class="avatar" style="background:${u.color || '#ffd43b'}">${u.emoji || '😎'}</span>
      <div style="min-width:0"><div class="user-card__name">${nameOf(u)}${u.username ? html` <span class="muted mono" style="font-size:12px">@${u.username}</span>` : ''}</div>
        <div class="user-card__mail">${u.email} · aktif ${timeAgo(u.lastSeenAt)}</div></div>
      ${mode === 'sus' ? html`<div class="score"><b style="color:${u.level === 'high' ? 'var(--red)' : u.level === 'medium' ? 'var(--orange)' : 'var(--blue)'}">${u.score}</b><span>RISIKO</span></div>` : ''}
    </div>
    ${mode === 'sus' ? html`
      <div class="progress lv-${u.level}" style="--p:${u.score}%"><i></i></div>
      <div class="chips"><span class="badge ${lvl[1]}">${lvl[0]}</span>${u.signals.map((s) => html`<span class="signal ${s.key === 'reports' || s.key === 'blocked' ? 'signal--red' : ''}">${raw(icon(s.key === 'reports' ? 'flag' : s.key === 'blocked' ? 'ban' : 'zap', 'ico" style="width:14px;height:14px'))} ${s.label}</span>`)}</div>
      ${u.lastNote ? html`<div class="quote">“${u.lastNote}”</div>` : ''}` : ''}
    ${u.state !== 'ok' ? html`<div class="chips"><span class="badge ${sb}">${raw(icon(si))} ${sl}</span>
        ${u.until ? html`<span class="badge mono">⏳ sisa <span class="countdown" data-until="${u.until}">${remaining(u.until)}</span></span>` : ''}
        ${cat ? html`<span class="badge">${cat.emoji} ${cat.label}</span>` : ''}</div>
      ${u.reason && u.reason !== u.category ? html`<div class="quote" style="border-color:var(--yellow)">${u.reason}</div>` : ''}` : ''}
    <div class="user-card__actions">
      ${u.state === 'ok' ? html`
        <button class="btn btn--yellow" data-act="limit" data-anim="wiggle">${raw(icon('timer'))} Batas Waktu</button>
        <button class="btn btn--red" data-act="disable" data-anim="shake">${raw(icon('ban'))} Nonaktifkan</button>` : html`
        <button class="btn btn--mint" data-act="restore" data-anim="spin">${raw(icon('undo'))} Pulihkan Akun</button>
        ${u.state === 'limited' ? html`<button class="btn btn--red" data-act="disable" data-anim="shake">${raw(icon('ban'))} Nonaktifkan</button>` : ''}`}
    </div>
  </article>`;
}

const empty = (ic, title, text, tile = 'tile--mint') => html`<div class="empty"><span class="tile ${tile} bounce">${raw(icon(ic))}</span><h4>${title}</h4><p class="muted">${text}</p></div>`;

export default {
  id: 'moderasi', title: 'Moderasi', icon: 'shield',
  render(root, ctx) {
    root.innerHTML = html`
      <div class="section-title"><span class="pill-label">Keamanan</span></div>
      <div class="section-title" style="margin-top:0"><h1>Blokir & <em>Moderasi</em></h1></div>
      <div class="seg" role="tablist" id="tabs">
        <button role="tab" data-tab="sus" aria-selected="true">${raw(icon('alert'))} Mencurigakan <span class="count" data-c="sus" hidden></span></button>
        <button role="tab" data-tab="res" aria-selected="false">${raw(icon('ban'))} Dibatasi <span class="count" data-c="res" hidden></span></button>
        <button role="tab" data-tab="find" aria-selected="false">${raw(icon('search'))} Cari Akun</button>
        <button role="tab" data-tab="log" aria-selected="false">${raw(icon('history'))} Riwayat</button>
      </div>
      <div id="panel" style="margin-top:18px"></div>`.toString();

    const panel = $('#panel', root);
    let tab = 'sus', sus = [], res = [], found = [], logs = [], q = '', loading = true;

    const countBadge = (k, n) => { const el = $(`[data-c="${k}"]`, root); el.hidden = !n; el.textContent = n; };

    async function load() {
      loading = true; draw();
      try {
        const [a, b] = await Promise.all([get('/admin/suspicious'), get('/admin/restricted')]);
        sus = a.items; res = b.users;
        countBadge('sus', sus.length); countBadge('res', res.length);
      } catch (e) { toast(e.message, 'err'); }
      loading = false; draw();
    }

    function draw() {
      if (loading) { panel.innerHTML = '<div class="list"><div class="skel" style="height:170px;border-radius:20px"></div><div class="skel" style="height:170px;border-radius:20px"></div></div>'; return; }
      if (tab === 'sus') {
        panel.innerHTML = (sus.length ? html`<div class="notice-box" style="margin-bottom:16px">${raw(icon('info'))}<span>Dihitung otomatis dari <b>jumlah pesan, sebaran chat, diblokir banyak orang</b>, dan <b>laporan pengguna</b>. Isi pesan tidak pernah dibaca (E2EE).</span></div>
          <div class="cards-2">${sus.map((u, i) => userCard(u, i, 'sus'))}</div>` : empty('shield', 'Tidak ada aktivitas mencurigakan', 'Bagus! Belum ada akun yang melewati ambang spam / penipuan.')).toString();
      } else if (tab === 'res') {
        panel.innerHTML = (res.length ? html`<div class="cards-2">${res.map((u, i) => userCard(u, i, 'res'))}</div>` : empty('check', 'Tidak ada akun yang dibatasi', 'Akun yang kamu nonaktifkan atau beri batas waktu akan muncul di sini.')).toString();
      } else if (tab === 'find') {
        panel.innerHTML = html`<div class="field"><label for="q">Cari email / @username</label>
            <div class="input-wrap"><input class="input" id="q" value="${q}" placeholder="mis. budi atau budi@gmail.com" autocomplete="off"><span class="icon-btn" style="pointer-events:none;border:0;box-shadow:none;background:none">${raw(icon('search'))}</span></div></div>
          <div id="found" class="cards-2">${q.length < 2 ? raw(empty('search', 'Ketik minimal 2 huruf', 'Cari akun mana pun untuk dibatasi atau dinonaktifkan.', 'tile--sky')) : ''}</div>`.toString();
        const inp = $('#q', panel); inp.focus(); inp.setSelectionRange(q.length, q.length);
        if (q.length >= 2) drawFound();
      } else {
        panel.innerHTML = (logs.length ? html`<div class="timeline">${logs.map((l) => { const [t, ic, tile] = LOG[l.action] ?? [l.action, 'info', '']; return html`
          <div class="tl-item"><span class="tile ${tile}">${raw(icon(ic))}</span><div><b>${l.user}</b> — ${t}${l.category ? ` · ${l.category}` : ''}${l.until ? html` · sampai ${fmtDateTime(l.until)}` : ''}
            ${l.reason ? html`<div class="muted" style="font-size:13px">“${l.reason}”</div>` : ''}<time>${timeAgo(l.createdAt)} · oleh ${l.admin}</time></div></div>`; })}</div>` : empty('history', 'Belum ada riwayat', 'Setiap tindakan moderasi dicatat di sini.', 'tile--purple')).toString();
      }
    }
    const drawFound = () => { $('#found', panel).innerHTML = (found.length ? found.map((u, i) => userCard(u, i, 'find')) : [empty('search', 'Tidak ditemukan', `Tidak ada akun yang cocok dengan “${q}”.`, 'tile--yellow')]).join(''); };

    let timer;
    root.addEventListener('input', (e) => {
      if (e.target.id !== 'q') return;
      q = e.target.value.trim().replace(/^@/, ''); clearTimeout(timer);
      if (q.length < 2) { found = []; $('#found', panel).innerHTML = empty('search', 'Ketik minimal 2 huruf', 'Cari akun mana pun untuk dibatasi atau dinonaktifkan.', 'tile--sky').toString(); return; }
      timer = setTimeout(async () => { try { found = (await get(`/admin/users/search?q=${encodeURIComponent(q)}`)).users; drawFound(); } catch (x) { toast(x.message, 'err'); } }, 300);
    });

    $('#tabs', root).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      tab = b.dataset.tab;
      $$('[data-tab]', root).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      if (tab === 'log') { try { logs = (await get('/admin/moderation-log')).log; } catch (x) { toast(x.message, 'err'); } }
      draw();
    });

    const findUser = (id) => [...sus, ...res, ...found].find((u) => u.id === id);
    async function done(msg) { toast(msg, 'ok'); await load(); ctx.refreshStats(); if (tab === 'find' && q.length >= 2) { found = (await get(`/admin/users/search?q=${encodeURIComponent(q)}`)).users; draw(); } }

    root.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]'); if (!act) return;
      const u = findUser(act.closest('[data-uid]').dataset.uid); if (!u) return;
      if (act.dataset.act === 'limit') limitModal(u);
      if (act.dataset.act === 'disable') disableModal(u);
      if (act.dataset.act === 'restore' && await confirmBox({ title: 'Pulihkan akun?', text: `${nameOf(u)} bisa memakai aplikasi lagi seperti biasa.`, ok: 'Pulihkan', ic: 'undo' })) {
        try { await post(`/admin/users/${u.id}/restore`); done('Akun dipulihkan'); } catch (x) { toast(x.message, 'err'); }
      }
    });

    /* ───── Pilihan kategori + alasan (dipakai kedua modal) ───── */
    const catChips = (sel) => html`<div class="field"><span class="label">Kategori</span><div class="chips" data-cats>${CATEGORIES.map((c) => html`<button type="button" class="chip" data-cat="${c.v}" aria-pressed="${c.v === sel}">${c.emoji} ${c.label}</button>`)}</div></div>
      <div class="field"><label for="why">Alasan / catatan <span style="text-transform:none;font-weight:600">(opsional)</span></label><textarea class="input" id="why" maxlength="300" placeholder="mis. kirim link judi ke banyak orang"></textarea></div>`;
    const pickable = (m, sel, attr, cb) => m.el.addEventListener('click', (e) => {
      const b = e.target.closest(`[${attr}]`); if (!b) return;
      $$(`[${attr}]`, b.parentElement).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      cb(b.getAttribute(attr));
    });

    function limitModal(u) {
      const st = { hours: 6, category: 'spam' };
      const m = openModal({
        title: 'Batas Waktu Kirim Chat', icon: 'timer',
        body: html`<div class="notice-box" style="margin-bottom:14px">${raw(icon('timer'))}<span><b>${nameOf(u)}</b> masih bisa membuka & membaca chat, tapi <b>tidak bisa mengirim</b> pesan, status, atau menelepon selama waktu ini.</span></div>
          <div class="field"><span class="label">Durasi</span><div class="chips">${[1, 3, 6, 12, 24, 72, 168].map((h) => html`<button type="button" class="chip" data-h="${h}" aria-pressed="${h === 6}">${h >= 24 ? `${h / 24} hari` : `${h} jam`}</button>`)}</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><input class="input" id="hrs" type="number" min="1" max="720" value="6" style="max-width:110px"><span class="hint">jam (kustom, maks 720)</span></div></div>
          ${catChips('spam')}<p class="hint" id="pv"></p>`,
        foot: html`<button class="btn" data-close>Batal</button><button class="btn btn--yellow" id="ok" data-anim="wiggle">${raw(icon('timer'))} Terapkan</button>`,
      });
      const pv = () => { m.$('#pv').innerHTML = `⏳ Berlaku sampai <b>${fmtDateTime(Date.now() + st.hours * 3600e3)}</b>`; }; pv();
      pickable(m, 'h', 'data-h', (v) => { st.hours = +v; m.$('#hrs').value = v; pv(); });
      pickable(m, 'c', 'data-cat', (v) => { st.category = v; });
      m.$('#hrs').addEventListener('input', (e) => { st.hours = Math.min(720, Math.max(1, +e.target.value || 1)); $$('[data-h]', m.el).forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.h === st.hours))); pv(); });
      m.$('#ok').onclick = (e) => withLoading(e.currentTarget, async () => {
        try { await post(`/admin/users/${u.id}/limit`, { hours: st.hours, category: st.category, reason: m.$('#why').value.trim() }); m.close(); done(`${nameOf(u)} dibatasi ${st.hours} jam`); }
        catch (x) { toast(x.message, 'err'); }
      });
    }

    function disableModal(u) {
      const st = { mode: 'spam', days: 3, category: 'spam' };
      const m = openModal({
        title: 'Nonaktifkan Akun', icon: 'ban',
        body: html`<div class="field"><span class="label">Jenis</span><div class="opt-grid">
            <button type="button" class="opt" data-mode="spam" aria-pressed="true"><b>${raw(icon('clock'))} Spam</b><small>Sementara, otomatis aktif lagi</small></button>
            <button type="button" class="opt opt--red" data-mode="permanent" aria-pressed="false"><b>${raw(icon('ban'))} Permanen</b><small>Tidak bisa masuk lagi</small></button></div></div>
          <div class="field" id="dur"><span class="label">Lama nonaktif</span><div class="chips">${[1, 3, 7, 14, 30].map((d) => html`<button type="button" class="chip" data-d="${d}" aria-pressed="${d === 3}">${d} hari</button>`)}</div></div>
          ${catChips('spam')}
          <div class="notice-box notice-box--red" id="warn">${raw(icon('alert'))}<span id="warnTxt"></span></div>`,
        foot: html`<button class="btn" data-close>Batal</button><button class="btn btn--red" id="ok" data-anim="shake">${raw(icon('ban'))} Nonaktifkan</button>`,
      });
      const warn = () => {
        m.$('#dur').hidden = st.mode === 'permanent';
        m.$('#warnTxt').innerHTML = st.mode === 'permanent'
          ? `<b>${esc(nameOf(u))}</b> akan <b>ditolak masuk selamanya</b> dengan pesan “akun dinonaktifkan”, mirip WhatsApp. Aplikasi langsung logout saat request berikutnya.`
          : `<b>${esc(nameOf(u))}</b> tidak bisa memakai aplikasi selama <b>${st.days} hari</b> (sampai ${fmtDateTime(Date.now() + st.days * 864e5)}), lalu otomatis aktif lagi.`;
      };
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); warn();
      pickable(m, 'm', 'data-mode', (v) => { st.mode = v; warn(); });
      pickable(m, 'd', 'data-d', (v) => { st.days = +v; warn(); });
      pickable(m, 'c', 'data-cat', (v) => { st.category = v; });
      m.$('#ok').onclick = (e) => withLoading(e.currentTarget, async () => {
        try { await post(`/admin/users/${u.id}/disable`, { mode: st.mode, days: st.days, category: st.category, reason: m.$('#why').value.trim() }); m.close(); done(`${nameOf(u)} dinonaktifkan`); }
        catch (x) { toast(x.message, 'err'); }
      });
    }

    // hitung mundur "sisa waktu" yang hidup
    const iv = setInterval(() => $$('[data-until]', root).forEach((el) => { el.textContent = remaining(el.dataset.until); }), 30000);
    ctx.onReload(load);
    load();
    return () => { clearInterval(iv); clearTimeout(timer); };
  },
};
