import type { IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { jwtSecret, opt } from './env';
import { HttpError } from './http';
import { signJwt, verifyJwt } from './jwt';

export const ADMIN_TOKEN_TTL = 12 * 3600;

interface AdminRecord { username: string; passwordHash: string }
let cached: AdminRecord | null = null;

/** Baca kredensial admin dari database.json (di root backend; ikut ter-deploy lewat vercel.json includeFiles). */
export function loadAdmin(): AdminRecord {
  if (cached) return cached;
  const files = [
    join(process.cwd(), 'database.json'),
    join(__dirname, '..', 'database.json'),
    join(__dirname, '..', '..', 'database.json'),
  ];
  for (const f of files) {
    try {
      const a = JSON.parse(readFileSync(f, 'utf8'))?.admin;
      if (typeof a?.username === 'string' && typeof a?.passwordHash === 'string') return (cached = a);
    } catch { /* coba lokasi berikutnya */ }
  }
  throw new HttpError(500, 'database.json (admin) tidak ditemukan');
}

function passwordMatches(plain: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  const got = scryptSync(plain, Buffer.from(salt, 'hex'), want.length, { N: +N, r: +r, p: +p });
  return got.length === want.length && timingSafeEqual(got, want);
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Selalu menghitung hash walau username salah, supaya waktu respons tidak membocorkan username. */
export function checkAdminLogin(username: string, password: string): boolean {
  const a = loadAdmin();
  const passOk = passwordMatches(password, a.passwordHash);
  return sameText(username, a.username) && passOk;
}

// Dipisah dari JWT_SECRET agar token user biasa tidak pernah sah sebagai token admin.
const adminSecret = () => `${opt('ADMIN_SECRET') || jwtSecret()}:r1z-admin`;

export const issueAdminToken = (username: string) => signJwt(`admin:${username}`, adminSecret(), ADMIN_TOKEN_TTL);

/** Pastikan permintaan membawa token admin yang sah. Mengembalikan username admin. */
export function requireAdmin(req: IncomingMessage): string {
  const h = String(req.headers.authorization ?? '');
  const sub = h.startsWith('Bearer ') ? verifyJwt(h.slice(7), adminSecret()) : null;
  if (!sub || !sub.startsWith('admin:')) throw new HttpError(401, 'Sesi admin tidak valid. Silakan masuk lagi.');
  return sub.slice(6);
}
