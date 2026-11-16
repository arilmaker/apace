import { dayLabel, esc, fmtNum } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const niceMax = (v) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; };

/** Grafik mingguan: batang = unduhan, garis = pendaftar. Animasi tumbuh + tooltip. */
export function weekChart(el, days) {
  const W = 640, H = 300, pl = 42, pr = 14, pt = 18, pb = 36;
  const iw = W - pl - pr, ih = H - pt - pb;
  const max = niceMax(Math.max(1, ...days.map((d) => Math.max(d.installs, d.signups))));
  const band = iw / days.length, bw = Math.min(46, band * 0.5);
  const x = (i) => pl + band * i + band / 2;
  const y = (v) => pt + ih - (v / max) * ih;

  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="var(--ink)" stroke-opacity=".18" stroke-dasharray="5 6" stroke-width="1.6"/>
          <text x="${pl - 8}" y="${yy + 4}" text-anchor="end" font-size="11" font-weight="700" fill="var(--muted)" font-family="var(--font-mono)">${fmtNum(Math.round(v))}</text>`;
  }
  const bars = days.map((d, i) => d.future ? '' : `
    <rect class="cbar" x="${x(i) - bw / 2}" y="${y(d.installs)}" width="${bw}" height="${Math.max(3, ih - (y(d.installs) - pt))}" rx="7"
      fill="var(--blue)" stroke="var(--ink)" stroke-width="3" style="transform-origin:${x(i)}px ${pt + ih}px;animation:growY .8s ${i * 80}ms var(--ease-pop) both"/>`).join('');
  const live = days.map((d, i) => ({ ...d, i })).filter((d) => !d.future);
  const path = live.map((d, k) => `${k ? 'L' : 'M'}${x(d.i)},${y(d.signups)}`).join(' ');
  const line = live.length > 1 ? `<path d="${path}" fill="none" stroke="var(--red)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="--len:900;stroke-dasharray:900;animation:drawLine 1.2s .4s ease-out forwards"/>` : '';
  const dots = live.map((d) => `<circle cx="${x(d.i)}" cy="${y(d.signups)}" r="6" fill="#fff" stroke="var(--red)" stroke-width="3.5" style="transform-origin:${x(d.i)}px ${y(d.signups)}px;animation:dotPop .4s ${700 + d.i * 90}ms var(--ease-pop) both"/>`).join('');
  const labels = days.map((d, i) => `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="12.5" font-weight="800" fill="${d.future ? 'var(--muted)' : 'var(--text)'}" opacity="${d.future ? .5 : 1}">${dayLabel(d.date)}</text>`).join('');
  const hit = days.map((d, i) => `<rect class="hit" data-i="${i}" x="${pl + band * i}" y="${pt}" width="${band}" height="${ih + pb}" fill="transparent"/>`).join('');

  el.innerHTML = `<div class="chart-wrap" style="position:relative">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik unduhan minggu ini" style="width:100%;height:auto;overflow:visible">${g}${bars}${line}${dots}${labels}<line class="cursor" y1="${pt}" y2="${pt + ih}" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 4" opacity="0"/>${hit}</svg>
    <div class="chart-tip" style="position:absolute;pointer-events:none;opacity:0;transform:translate(-50%,-100%) scale(.9);transition:opacity .15s,transform .2s var(--ease-pop);padding:8px 12px;font-size:12.5px;font-weight:700;background:var(--navy);color:#fff;border:3px solid var(--ink);border-radius:12px;box-shadow:3px 3px 0 var(--shadow-c);white-space:nowrap;z-index:3"></div>
  </div>`;

  const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), cur = el.querySelector('.cursor');
  const show = (i) => {
    const d = days[i], px = (x(i) / W) * svg.clientWidth, py = (y(Math.max(d.installs, d.signups)) / H) * svg.clientHeight;
    tip.innerHTML = `<div style="color:#8fb4ff">${esc(dayLabel(d.date))}, ${esc(d.date.slice(5).split('-').reverse().join('/'))}</div>
      ⬇ <b>${fmtNum(d.installs)}</b> unduhan<br>👤 <b>${fmtNum(d.signups)}</b> pendaftar${d.future ? '<br><i>belum terjadi</i>' : ''}`;
    tip.style.left = `${px}px`; tip.style.top = `${py - 8}px`; tip.style.opacity = 1; tip.style.transform = 'translate(-50%,-100%) scale(1)';
    cur.setAttribute('x1', x(i)); cur.setAttribute('x2', x(i)); cur.setAttribute('opacity', .5);
  };
  const hide = () => { tip.style.opacity = 0; tip.style.transform = 'translate(-50%,-100%) scale(.9)'; cur.setAttribute('opacity', 0); };
  el.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('mouseenter', () => show(+r.dataset.i));
    r.addEventListener('touchstart', () => show(+r.dataset.i), { passive: true });
    r.addEventListener('mouseleave', hide);
  });
  svg.addEventListener('touchend', () => setTimeout(hide, 1600));
}

/** Garis kecil (sparkline) untuk kartu Users. */
export function sparkline(values, color = 'var(--blue)') {
  const W = 120, H = 44, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, H - 5 - (v / max) * (H - 12)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d} L${W},${H} L0,${H}Z" fill="${color}" opacity=".16"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="--len:300;stroke-dasharray:300;animation:drawLine 1.1s ease-out forwards"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="#fff" stroke="${color}" stroke-width="3"/></svg>`;
}
