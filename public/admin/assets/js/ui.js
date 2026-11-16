import { icon } from './icons.js';
import { DAYS_ID, MONTHS_ID, TZ, THEME_KEY } from './config.js';

/* ───────── Template aman (auto-escape) ───────── */
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** html`<b>${userInput}</b>` -> nilai di-escape otomatis; html bersarang & raw() tidak. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      out += Array.isArray(v) ? v.map((x) => (x instanceof Safe ? x.s : esc(x))).join('') : v instanceof Safe ? v.s : esc(v);
    }
  });
  return new Safe(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function mount(el, tpl) { el.innerHTML = tpl.toString(); return el; }
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── Format ───────── */
export const fmtNum = (n) => new Intl.NumberFormat('id-ID').format(n ?? 0);
export function fmtDateTime(d) {
  if (!d) return '-';
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)).replace('.', ':');
}
export function timeAgo(d) {
  if (!d) return 'belum pernah';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'baru saja';
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  return `${Math.round(s / 86400)} hari lalu`;
}
/** "2j 14m" / "3h 4j" — sisa waktu sampai `until`. */
export function remaining(until) {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return 'selesai';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d}h ${h % 24}j`;
  if (h >= 1) return `${h}j ${m % 60}m`;
  return `${m}m`;
}
export const dayLabel = (iso) => DAYS_ID[new Date(iso + 'T00:00:00').getDay()].slice(0, 3);
export const longDate = (d = new Date()) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  const dow = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }[g('weekday')];
  return `${DAYS_ID[dow]}, ${g('day')} ${MONTHS_ID[+g('month') - 1]} ${g('year')}`;
};

/* ───────── Hitung naik (count-up) ───────── */
export function countUp(el, to, ms = 900) {
  if (!el) return;
  const from = +el.dataset.val || 0;
  el.dataset.val = to;
  if (from === to) { el.textContent = fmtNum(to); return; }
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  (function tick(now) {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmtNum(Math.round(from + (to - from) * ease(k)));
    if (k < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ───────── Toast ───────── */
export function toast(msg, type = 'ok', sub = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = html`<span class="tile">${raw(icon(type === 'ok' ? 'check' : type === 'err' ? 'x' : 'info'))}</span><div>${msg}${sub ? raw(`<small>${esc(sub)}</small>`) : ''}</div>`.toString();
  box.append(el);
  setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 260); }, type === 'err' ? 5200 : 3200);
}

/* ───────── Modal ───────── */
export function openModal({ title, icon: ic = 'info', body, foot = '', onMount, closable = true }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal__head"><span class="tile tile--blue">${icon(ic)}</span><h3>${esc(title)}</h3>
      ${closable ? `<button class="icon-btn" data-close aria-label="Tutup" data-anim="spin">${icon('x')}</button>` : ''}</div>
    <div class="modal__body"></div><div class="modal__foot"></div></div>`;
  $('.modal__body', ov).innerHTML = body.toString();
  $('.modal__foot', ov).innerHTML = foot.toString();
  document.body.append(ov);
  document.body.style.overflow = 'hidden';
  const api = {
    el: ov,
    $: (s) => $(s, ov),
    close() {
      ov.classList.add('is-closing');
      setTimeout(() => { ov.remove(); if (!$('.overlay')) document.body.style.overflow = ''; }, 200);
      document.removeEventListener('keydown', onKey);
    },
    setBody(tpl) { $('.modal__body', ov).innerHTML = tpl.toString(); },
    setFoot(tpl) { $('.modal__foot', ov).innerHTML = tpl.toString(); },
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable) api.close(); };
  document.addEventListener('keydown', onKey);
  if (closable) ov.addEventListener('mousedown', (e) => { if (e.target === ov) api.close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  onMount?.(api);
  setTimeout(() => $('input:not([type=hidden]), textarea, select', ov)?.focus(), 80);
  return api;
}

/** Dialog konfirmasi bergaya neo-brutal. Mengembalikan Promise<boolean>. */
export function confirmBox({ title, text, ok = 'Ya, lanjut', danger = false, ic = 'alert' }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, icon: ic,
      body: html`<p style="font-weight:600">${text}</p>`,
      foot: html`<button class="btn" data-close>Batal</button><button class="btn ${danger ? 'btn--red' : 'btn--blue'}" data-ok>${ok}</button>`,
    });
    m.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) { done = true; resolve(true); m.close(); }
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { if (!done) resolve(false); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  });
}

/* ───────── Ripple + tombol loading ───────── */
export function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.btn, .chip');
    if (!t || t.disabled) return;
    const r = t.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'rip';
    s.style.left = `${e.clientX - r.left}px`; s.style.top = `${e.clientY - r.top}px`;
    t.append(s);
    setTimeout(() => s.remove(), 650);
  });
}
export async function withLoading(btn, fn) {
  const old = btn.innerHTML;
  btn.classList.add('is-loading');
  btn.innerHTML = '<span class="spinner"></span> Memproses…';
  try { return await fn(); } finally { btn.classList.remove('is-loading'); btn.innerHTML = old; }
}

/* ───────── Tema ───────── */
export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
}
export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
export const isDark = () => document.documentElement.dataset.theme === 'dark';

/* Konfeti kecil untuk momen sukses */
export function confetti(container, n = 18) {
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const colors = ['var(--yellow)', 'var(--sky)', 'var(--pink)', 'var(--mint)', 'var(--red)', 'var(--purple)'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 90;
    p.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 20}px;--r:${Math.random() * 540 - 270}deg;background:${colors[i % colors.length]};border-radius:${i % 3 ? '3px' : '50%'}`;
    wrap.append(p);
  }
  container.append(wrap);
  setTimeout(() => wrap.remove(), 1300);
}
