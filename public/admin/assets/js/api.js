import { API_BASE, TOKEN_KEY } from './config.js';

export class ApiError extends Error {
  constructor(message, status, data = {}) { super(message); this.status = status; this.data = data; this.code = data.code ?? null; }
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
  if (!res.ok) throw new ApiError(data.error || `Terjadi kesalahan (${res.status})`, res.status, data);
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
