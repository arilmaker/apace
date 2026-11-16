import { BRAND } from '../config.js';
import { icon, STAR } from '../icons.js';
import { get } from '../api.js';
import { startClock, TZ_LABEL } from '../clock.js';
import { weekChart, sparkline } from '../charts.js';
import { $, html, raw, countUp, fmtNum, timeAgo, toast } from '../ui.js';

const ACTION = {
  limit: ['timer', 'tile--yellow', 'dibatasi kirim chat'],
  disable_spam: ['ban', 'tile--red', 'dinonaktifkan (spam)'],
  disable_permanent: ['ban', 'tile--red', 'dinonaktifkan permanen'],
  restore: ['undo', 'tile--mint', 'dipulihkan'],
};
const SERVER = {
  ok: ['Normal', 'badge--mint', 'dot'], degraded: ['Gangguan', 'badge--yellow', 'dot dot--yellow'],
  maintenance: ['Maintenance', 'badge--blue', 'dot dot--yellow'], down: ['Down', 'badge--red', 'dot dot--red'],
};

const statCard = ({ id, go, tile, ic, label, anim, i }) => html`
  <button class="stat stagger" style="--i:${i}" data-go="${go}" data-anim="${anim}" data-stat="${id}">
    <div class="stat__head"><span class="tile ${tile}">${raw(icon(ic))}</span>${label}</div>
    <div class="stat__num"><span data-num>0</span><small data-unit></small></div>
    <div class="stat__sub" data-sub>&nbsp;</div>
    <div class="stat__viz" data-viz></div>
  </button>`;

export default {
  id: 'dashboard', title: 'Dashboard', icon: 'layout',
  render(root, ctx) {
    root.innerHTML = html`
      <section class="hero stagger" style="--i:0">
        <span class="star" style="width:30px;left:46%;top:14px">${raw(STAR)}</span>
        <span class="star" style="width:18px;right:22px;bottom:18px;fill:var(--cyan);animation-delay:-3s">${raw(STAR)}</span>
        <div class="hero__grid">
          <div>
            <span class="hero__kicker">${raw(icon('zap'))} ADMIN CONTROL PANEL</span>
            <p class="hero__hello"><span class="hero__greet">Halo</span>, <b>rilz121</b> 👋</p>
            <span class="brand brand--xl"><span class="brand__name"><b>${BRAND.blue}</b>${BRAND.white}</span></span>
            <p style="margin-top:10px;font-weight:600;color:#cfe0ff;max-width:420px">Pantau Gmail OTP, pengguna online, akun bermasalah, dan unduhan aplikasi — semua di satu layar.</p>
          </div>
          <div class="clock" aria-label="Jam sekarang">
            <div class="clock__top"><span>${raw(icon('clock'))} Waktu</span><span class="badge badge--navy" style="border-color:#fff">${TZ_LABEL}</span></div>
            <div class="clock__time"><span class="clock__h">00</span><span class="clock__colon">:</span><span class="clock__m">00</span><span class="clock__sec">00</span></div>
            <div class="clock__date">—</div>
            <div class="daybar" aria-hidden="true"></div>
            <div class="clock__foot"><span class="clock__pct">Hari ini 0% berlalu</span><span>00 ─ 24 jam</span></div>
          </div>
        </div>
      </section>

      <section class="grid-stats" aria-label="Ringkasan">
        ${statCard({ id: 'gmail', go: '#/gmail', tile: 'tile--red', ic: 'mail', label: 'Gmail Aktif', anim: 'wiggle', i: 1 })}
        ${statCard({ id: 'users', go: '#/moderasi', tile: 'tile--blue', ic: 'users', label: 'Users Aktif', anim: 'bounce', i: 2 })}
        ${statCard({ id: 'mod', go: '#/moderasi', tile: 'tile--yellow', ic: 'ban', label: 'Nonaktifkan', anim: 'shake', i: 3 })}
        ${statCard({ id: 'dl', go: '#dl', tile: 'tile--mint', ic: 'download', label: 'Download', anim: 'down', i: 4 })}
      </section>

      <div class="wave"></div>

      <div class="cols cols--2" style="margin-top:0">
        <section class="card stagger" style="--i:5" id="dl">
          <div class="card__head"><span class="tile tile--mint">${raw(icon('activity'))}</span>
            <div class="grow"><div class="card__title">Grafik Download Minggu Ini</div><div class="card__sub">Senin – Minggu · zona ${TZ_LABEL}</div></div>
            <span class="livebar"><span class="dot"></span> LIVE</span></div>
          <div class="chips" style="margin-bottom:10px" data-legend>
            <span class="badge badge--blue"><i style="width:10px;height:10px;background:var(--blue);border:2px solid var(--ink);border-radius:3px"></i> Unduhan</span>
            <span class="badge badge--red"><i style="width:10px;height:3px;background:var(--red);border-radius:3px"></i> Pendaftar baru</span>
            <span class="badge" data-wk>Total minggu ini: …</span></div>
          <div data-chart><div class="skel" style="height:260px"></div></div>
        </section>

        <div class="list">
          <section class="card stagger" style="--i:6">
            <div class="card__head"><span class="tile tile--cyan">${raw(icon('server'))}</span><div class="grow"><div class="card__title">Status Server</div><div class="card__sub">Yang dilihat pengguna di aplikasi</div></div></div>
            <div data-server class="skel" style="height:34px"></div>
            <a class="btn btn--sm btn--sky btn--block" style="margin-top:14px" href="#/peringatan" data-anim="slide">${raw(icon('megaphone'))} Atur status & kirim peringatan</a>
          </section>
          <section class="card stagger" style="--i:7">
            <div class="card__head"><span class="tile tile--pink">${raw(icon('zap'))}</span><div class="card__title">Aksi Cepat</div></div>
            <div class="quick">
              <a class="btn btn--blue" href="#/gmail" data-add data-anim="plus">${raw(icon('plus'))} Tambah Gmail</a>
              <a class="btn btn--yellow" href="#/moderasi" data-anim="shake">${raw(icon('shield'))} Cek Mencurigakan</a>
              <a class="btn btn--mint" href="#/peringatan" data-anim="fly">${raw(icon('send'))} Kirim Peringatan</a>
              <button class="btn" data-reload data-anim="spin">${raw(icon('refresh'))} Segarkan Data</button>
            </div>
          </section>
        </div>
      </div>

      <section class="card stagger" style="--i:8;margin-top:20px">
        <div class="card__head"><span class="tile tile--purple">${raw(icon('history'))}</span><div class="grow"><div class="card__title">Aktivitas Moderasi Terbaru</div><div class="card__sub">Tindakan admin terakhir</div></div>
          <a class="btn btn--sm" href="#/moderasi" data-anim="slide">Lihat semua ${raw(icon('chevron', 'ico'))}</a></div>
        <div class="timeline" data-log><div class="skel" style="height:54px"></div><div class="skel" style="height:54px"></div></div>
      </section>
      <p class="footer-note">${BRAND.blue}${BRAND.white} Admin · data otomatis diperbarui tiap 15 detik</p>`.toString();

    const stopClock = startClock(root);
    root.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]')?.dataset.go;
      if (go === '#dl') $('#dl', root).scrollIntoView({ behavior: 'smooth', block: 'center' });
      else if (go) location.hash = go;
      if (e.target.closest('[data-reload]')) ctx.refreshStats(false).then(() => toast('Data diperbarui', 'ok'));
    });

    const q = (id, s) => $(`[data-stat="${id}"] ${s}`, root);
    const bars = (arr) => arr.map((c, n) => `<i class="${c.cls}" style="--n:${n};${c.h ? `height:${c.h}%` : ''}"></i>`).join('');

    function paint(s) {
      if (!s) return;
      countUp(q('gmail', '[data-num]'), s.gmail.active);
      q('gmail', '[data-unit]').textContent = `/ ${s.gmail.total}`;
      q('gmail', '[data-sub]').textContent = `${fmtNum(s.gmail.sentToday)} OTP terkirim hari ini`;
      const dis = Math.max(0, s.gmail.total - s.gmail.active - s.gmail.errors);
      const gm = [...Array(s.gmail.active).fill({ cls: 'green' }), ...Array(s.gmail.errors).fill({ cls: 'red' }), ...Array(dis).fill({ cls: 'gray' })].slice(0, 14);
      q('gmail', '[data-viz]').innerHTML = gm.length ? bars(gm.map((x) => ({ ...x, h: 100 }))) : '<span class="muted" style="font-size:12px;font-weight:700">Belum ada Gmail — klik untuk menambah</span>';

      countUp(q('users', '[data-num]'), s.users.online);
      q('users', '[data-unit]').textContent = 'online';
      q('users', '[data-sub]').innerHTML = `dari <b>${fmtNum(s.users.total)}</b> terdaftar · <b>+${fmtNum(s.users.newToday)}</b> hari ini`;
      q('users', '[data-viz]').innerHTML = sparkline(s.users.signups14);

      countUp(q('mod', '[data-num]'), s.moderation.total);
      q('mod', '[data-unit]').textContent = 'akun';
      q('mod', '[data-sub]').textContent = 'diblokir / dibatasi sekarang';
      q('mod', '[data-viz]').innerHTML = `<div class="stat__chips">
        <span class="badge badge--red">${icon('ban')} ${s.moderation.permanent} permanen</span>
        <span class="badge badge--yellow">${icon('clock')} ${s.moderation.temporary} spam</span>
        <span class="badge badge--blue">${icon('timer')} ${s.moderation.limited} batas</span></div>`;

      const d = s.downloads;
      countUp(q('dl', '[data-num]'), d.week);
      q('dl', '[data-unit]').textContent = 'minggu ini';
      const maxI = Math.max(1, ...d.days.map((x) => x.installs));
      q('dl', '[data-sub]').innerHTML = d.change === null ? `minggu lalu: ${fmtNum(d.lastWeek)}` :
        `<span class="trend ${d.change < 0 ? 'trend--down' : ''}">${icon(d.change < 0 ? 'down' : 'up')} ${d.change > 0 ? '+' : ''}${d.change}%</span>`;
      q('dl', '[data-viz]').innerHTML = bars(d.days.map((x) => ({ cls: x.future ? 'gray' : 'green', h: x.future ? 12 : Math.max(12, (x.installs / maxI) * 100) })));

      $('[data-wk]', root).textContent = `Total minggu ini: ${fmtNum(d.week)} · minggu lalu: ${fmtNum(d.lastWeek)}`;
      weekChartOnce(d.days);
      const [label, badge, dot] = SERVER[s.server.status] ?? SERVER.ok;
      const srv = $('[data-server]', root);
      srv.className = '';
      srv.innerHTML = html`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="badge ${badge}"><span class="${dot}"></span> ${label}</span>
        <span style="font-size:13px;font-weight:600;color:var(--muted)">${s.server.message || 'Semua sistem berjalan normal'}</span></div>`.toString();
    }

    let chartSig = '';
    function weekChartOnce(days) {
      const sig = JSON.stringify(days);
      if (sig === chartSig) return;
      chartSig = sig;
      weekChart($('[data-chart]', root), days);
    }

    async function loadLog() {
      try {
        const { log } = await get('/admin/moderation-log');
        const box = $('[data-log]', root);
        box.innerHTML = log.length ? log.slice(0, 5).map((l) => {
          const [ic, tile, text] = ACTION[l.action] ?? ['info', '', l.action];
          return html`<div class="tl-item"><span class="tile ${tile}">${raw(icon(ic))}</span>
            <div><b>${l.user}</b> ${text}${l.reason ? html` — <i>${l.reason}</i>` : ''}<time>${timeAgo(l.createdAt)} · oleh ${l.admin}</time></div></div>`.toString();
        }).join('') : `<div class="empty"><span class="tile tile--mint">${icon('shield')}</span><h4>Belum ada tindakan</h4><p class="muted">Semua akun aman. Tindakan moderasi akan tampil di sini.</p></div>`;
      } catch { /* abaikan */ }
    }

    const unsub = ctx.store.subscribe(paint);
    loadLog();
    return () => { stopClock(); unsub(); };
  },
};
