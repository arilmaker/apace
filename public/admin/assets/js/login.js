import { BRAND } from './config.js';
import { icon, STAR } from './icons.js';
import { post, getToken, setToken } from './api.js';
import { $, applyTheme, initTheme, initRipple, isDark, raw, html } from './ui.js';

if (getToken()) location.replace('/admin/');
initTheme(); initRipple();
document.querySelectorAll('.deco i').forEach((i) => { i.innerHTML = STAR; });

const themeBtn = $('#theme');
const paintTheme = () => { themeBtn.innerHTML = icon(isDark() ? 'sun' : 'moon'); };
paintTheme();
themeBtn.onclick = () => { applyTheme(isDark() ? 'light' : 'dark'); paintTheme(); };

$('#brand').innerHTML = html`<span class="brand brand--xl"><span class="brand__name"><b>${BRAND.blue}</b>${BRAND.white}</span></span>`.toString();
$('.login__top').insertAdjacentHTML('beforeend', `<span class="star" style="position:absolute">${STAR}</span><span class="star" style="position:absolute">${STAR}</span>`);
const goTxt = $('#goTxt');
const idle = () => { goTxt.innerHTML = `${icon('lock')} Masuk Dashboard ${icon('zap')}`; };
idle();

const eye = $('#eye'), pw = $('#p');
eye.innerHTML = icon('eye');
eye.onclick = () => {
  const show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  eye.innerHTML = icon(show ? 'eyeoff' : 'eye');
  eye.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
};

const err = $('#err'), card = $('.login__card'), btn = $('#go');
function fail(msg) {
  err.hidden = false;
  err.innerHTML = `${icon('alert')}<span>${html`${msg}`}</span>`;
  card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const username = $('#u').value.trim(), password = pw.value;
  if (!username || !password) return fail('Isi username dan password dulu ya.');
  btn.classList.add('is-loading');
  goTxt.innerHTML = '<span class="spinner"></span> Memeriksa…';
  try {
    const r = await post('/admin/login', { username, password }).catch((x) => { throw x; });
    setToken(r.token);
    goTxt.innerHTML = `${icon('check')} Berhasil!`;
    btn.style.setProperty('--bg-btn', 'var(--mint)'); btn.style.setProperty('--fg-btn', '#062a17');
    setTimeout(() => location.replace('/admin/'), 550);
  } catch (x) {
    btn.classList.remove('is-loading'); idle();
    fail(x.message);
    pw.select();
  }
});
