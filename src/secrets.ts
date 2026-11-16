import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { jwtSecret, opt } from './env';

// Brankas kecil untuk App Password Gmail: AES-256-GCM, kunci diturunkan dari ADMIN_SECRET (atau JWT_SECRET).
const key = () => createHash('sha256').update(`r1z-gmail-vault:${opt('ADMIN_SECRET') || jwtSecret()}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function unseal(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('format rahasia tidak dikenal');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
