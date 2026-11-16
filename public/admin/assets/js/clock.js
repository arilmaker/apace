import { TZ, TZ_LABEL } from './config.js';
import { longDate } from './ui.js';

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function nowParts() {
  const p = fmt.formatToParts(new Date());
  const g = (t) => +p.find((x) => x.type === t).value % 24;
  return { h: g('hour'), m: g('minute'), s: g('second') };
}

export function greeting(h) {
  if (h < 4) return 'Masih begadang';
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Jam digital besar + 24 batang "hari ini sudah berlalu" (mirip kartu Waktu di video). */
export function startClock(root) {
  const $ = (s) => root.querySelector(s);
  const bars = $('.daybar');
  if (bars && !bars.children.length) bars.innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="--n:${i}"></i>`).join('');
  let lastDate = '';
  function tick() {
    const { h, m, s } = nowParts();
    $('.clock__h').textContent = String(h).padStart(2, '0');
    $('.clock__m').textContent = String(m).padStart(2, '0');
    $('.clock__sec').textContent = String(s).padStart(2, '0');
    const d = longDate();
    if (d !== lastDate) { $('.clock__date').textContent = d; lastDate = d; }
    const pct = Math.round(((h * 3600 + m * 60 + s) / 86400) * 100);
    $('.clock__pct').textContent = `Hari ini ${pct}% berlalu`;
    [...bars.children].forEach((b, i) => { b.className = i < h ? 'on' : i === h ? 'now' : ''; });
    const hello = $('.hero__greet');
    if (hello) hello.textContent = greeting(h);
  }
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
export { TZ_LABEL };
