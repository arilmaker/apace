import { BRAND, REFRESH_MS } from './config.js';
import { icon, STAR } from './icons.js';
import { get, getToken, clearToken } from './api.js';
import { $, $$, html, raw, initTheme, initRipple, applyTheme, isDark, toast, confirmBox } from './ui.js';
import dashboard from './views/dashboard.js';
import gmail from './views/gmail.js';
import moderasi from './views/moderasi.js';
import peringatan from './views/peringatan.js';
import rilis from './views/rilis.js';

if (!getToken()) location.replace('/admin/login.html');
initTheme(); initRipple();

const VIEWS = [dashboard, gmail, moderasi, peringatan, rilis];

/* ───────── Store statistik (dipakai banyak view) ───────── */
const store = {
  stats: null,
  subs: new Set(),
  subscribe(fn) { this.subs.add(fn); if (this.stats) fn(this.stats); return () => this.subs.delete(fn); },
  emit() { this.subs.forEach((fn) => fn(this.stats)); },
};
let refreshing = false;
async function refreshStats(silent = true) {
  if (refreshing) return;
  refreshing = true;
  try {
    store.stats = await get('/admin/stats');
    store.emit();
    paintNavBadges();
  } catch (e) {
    if (!silent) toast(e.message, 'err');
  } finally { refreshing = false; }
}

/* ───────── Shell ───────── */
const app = $('#app');
function shell() {
  app.innerHTML = html`
    <header class="wrap topbar">
      <div class="topbar__in">
        <a class="brand" href="#/dashboard" aria-label="Beranda">
          <span class="brand__mark">${raw(icon('chat'))}</span>
          <span class="brand__name"><b>${BRAND.blue}</b>${BRAND.white}</span>
        </a>
        <nav class="nav" aria-label="Menu utama">${VIEWS.map((v) => html`<a href="#/${v.id}" data-nav="${v.id}" data-anim="wiggle">${raw(icon(v.icon))}<span>${v.title}</span><span class="count" data-badge="${v.id}" hidden></span></a>`)}</nav>
        <div class="topbar__actions">
          <button class="icon-btn" id="btn-theme" aria-label="Ganti tema" data-anim="spin"></button>
          <button class="icon-btn" id="btn-refresh" aria-label="Segarkan" data-anim="spin">${raw(icon('refresh'))}</button>
          <button class="icon-btn menu-btn" id="btn-menu" aria-label="Buka menu" data-anim="wiggle">${raw(icon('menu'))}</button>
          <button class="icon-btn nav-logout" id="btn-logout" aria-label="Keluar" data-anim="slide" style="display:none">${raw(icon('logout'))}</button>
        </div>
      </div>
    </header>
    <main class="wrap" id="view" tabindex="-1"></main>`.toString();
  $$('.deco i').forEach((i) => { i.innerHTML = STAR; });
  const paintTheme = () => { $('#btn-theme').innerHTML = icon(isDark() ? 'sun' : 'moon'); };
  paintTheme();
  $('#btn-theme').onclick = () => { applyTheme(isDark() ? 'light' : 'dark'); paintTheme(); };
  $('#btn-refresh').onclick = async (e) => {
    const b = e.currentTarget; b.querySelector('.ico').classList.add('spin');
    await refreshStats(false);
    reloadFn?.();
    setTimeout(() => b.querySelector('.ico').classList.remove('spin'), 500);
  };
  $('#btn-menu').onclick = openDrawer;
  $('#btn-logout').onclick = logout;
  const mq = matchMedia('(min-width: 940px)');
  const sync = () => { $('#btn-logout').style.display = mq.matches ? '' : 'none'; };
  mq.addEventListener('change', sync); sync();
}

function openDrawer() {
  const ov = document.createElement('div');
  ov.className = 'drawer-ov';
  const dr = document.createElement('aside');
  dr.className = 'drawer';
  dr.setAttribute('aria-label', 'Menu');
  dr.innerHTML = html`
    <div class="drawer__head"><span class="pill-label">Menu</span>
      <button class="icon-btn" data-x aria-label="Tutup" data-anim="spin">${raw(icon('x'))}</button></div>
    ${VIEWS.map((v) => html`<a class="dlink ${location.hash.includes(v.id) ? 'is-active' : ''}" href="#/${v.id}" data-anim="wiggle"><span class="tile">${raw(icon(v.icon))}</span>${v.title}</a>`)}
    <div class="foot"><div class="wave" style="margin:6px auto"></div>
      <button class="btn btn--red btn--block" data-out data-anim="slide">${raw(icon('logout'))} Keluar</button></div>`.toString();
  document.body.append(ov, dr);
  const close = () => { ov.remove(); dr.remove(); };
  ov.onclick = close;
  dr.addEventListener('click', (e) => { if (e.target.closest('[data-x], .dlink')) close(); if (e.target.closest('[data-out]')) { close(); logout(); } });
}

async function logout() {
  if (!(await confirmBox({ title: 'Keluar dari dashboard?', text: 'Kamu perlu login lagi untuk membuka panel admin.', ok: 'Keluar', danger: true, ic: 'logout' }))) return;
  clearToken();
  location.replace('/admin/login.html');
}

function paintNavBadges() {
  const s = store.stats;
  if (!s) return;
  const set = (id, n) => $$(`[data-badge="${id}"]`).forEach((b) => { b.hidden = !n; b.textContent = n; });
  set('gmail', s.gmail.errors);
}

/* ───────── Router (hash) ───────── */
let current = null, cleanup = null, reloadFn = null;
function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1] || 'dashboard';
  const view = VIEWS.find((v) => v.id === id) || dashboard;
  cleanup?.(); cleanup = null; reloadFn = null;
  current = view;
  $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === view.id));
  const root = $('#view');
  root.innerHTML = '';
  root.className = 'wrap';
  document.title = `${view.title} — ${BRAND.blue}${BRAND.white} Admin`;
  cleanup = view.render(root, { store, refreshStats, onReload: (fn) => { reloadFn = fn; }, go: (h) => { location.hash = h; } }) || null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ───────── Mulai ───────── */
(async function boot() {
  try { await get('/admin/me'); } catch { return; } // 401 -> api.js mengarahkan ke login
  shell();
  window.addEventListener('hashchange', route);
  route();
  refreshStats();
  setInterval(() => { if (!document.hidden) refreshStats(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStats(); });
})();
