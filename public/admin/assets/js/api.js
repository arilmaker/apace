import { API_BASE, TOKEN_KEY } from './config.js';

function readableError(value, fallback = 'Permintaan gagal. Coba lagi.') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map((item) => readableError(item, '')).filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  if (value && typeof value === 'object') {
    for (const key of ['message', 'error', 'detail', 'description', 'reason']) {
      const message = readableError(value[key], '');
      if (message) return message;
    }
  }
  return fallback;
}

export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(readableError(message, `Terjadi kesalahan (${status || 'jaringan'}).`));
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = data?.code ?? null;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** fetch JSON ke /api/*. 401 (selain login) otomatis melempar ke halaman login. */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;

  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Cek internet kamu.', 0);
  }
  let data = {};
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (res.status === 401 && auth) {
    clearToken();
    if (!location.pathname.endsWith('login.html')) location.replace('/admin/login.html');
  }
  if (!res.ok) throw new ApiError(readableError(data?.error ?? data?.message, `Terjadi kesalahan (${res.status})`), res.status, data);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

/** Kirim byte mentah (potongan file) dengan token admin. Dipakai unggah APK per 4 MB. */
export async function apiBytes(path, bytes) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/octet-stream' };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  let res;
  try { res = await fetch(API_BASE + path, { method: 'POST', headers, body: bytes }); }
  catch { throw new ApiError('Tidak bisa terhubung ke server. Cek internet kamu.', 0); }
  let data = {};
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (res.status === 401) { clearToken(); location.replace('/admin/login.html'); }
  if (!res.ok) throw new ApiError(readableError(data?.error ?? data?.message, `Terjadi kesalahan (${res.status})`), res.status, data);
  return data;
}

/** Seperti apiBytes, tapi melaporkan progres unggahan: onProgress(terkirim, total). Dipakai overlay 0–100% di Rilis. */
export function apiBytesProgress(path, bytes, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + path);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    if (getToken()) xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    const netErr = () => reject(new ApiError('Tidak bisa terhubung ke server. Cek internet kamu.', 0));
    xhr.onerror = netErr;
    xhr.ontimeout = netErr;
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
      if (xhr.status === 401) { clearToken(); location.replace('/admin/login.html'); }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(readableError(data?.error ?? data?.message, `Terjadi kesalahan (${xhr.status})`), xhr.status, data));
    };
    xhr.send(bytes);
  });
}
