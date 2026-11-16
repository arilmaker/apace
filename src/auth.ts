import type { IncomingMessage } from 'node:http';
import { sql } from './db';
import { jwtSecret } from './env';
import { HttpError, unauthorized } from './http';
import { verifyJwt } from './jwt';

/** Verifikasi token, pastikan akun masih ada, dan perbarui "terakhir dilihat" (maks sekali per 15 detik). */
export async function requireUser(req: IncomingMessage): Promise<string> {
  const h = String(req.headers.authorization ?? '');
  if (!h.startsWith('Bearer ')) throw unauthorized();
  const uid = verifyJwt(h.slice(7), jwtSecret());
  if (!uid) throw unauthorized();

  const [u] = await sql`
    select id, (last_seen_at is null or last_seen_at < now() - interval '15 seconds') as stale,
           disabled_permanent, disabled_until, restriction_reason,
           (disabled_until is not null and disabled_until > now()) as disabled_now
    from users where id = ${uid}::uuid`;
  if (!u) throw unauthorized(); // akun sudah dihapus
  if (u.disabled_permanent || u.disabled_now) {
    throw new HttpError(403, 'Akun kamu dinonaktifkan.', {
      code: 'account_disabled',
      permanent: !!u.disabled_permanent,
      until: u.disabled_permanent ? null : u.disabled_until,
      reason: u.restriction_reason ?? null,
    });
  }
  if (u.stale) await sql`update users set last_seen_at = now() where id = ${uid}::uuid`;
  return uid;
}
