import { sql } from './db';
import type { Row } from './db';
import { HttpError, forbidden, notFound } from './http';

/** Pastikan `uid` anggota percakapan. Mengembalikan baris keanggotaan + jenis percakapan. */
export async function requireMember(conversationId: string, uid: string): Promise<Row> {
  const [m] = await sql`
    select cm.role, cm.joined_at, cm.cleared_at, c.kind, c.ttl_seconds
    from conversation_members cm join conversations c on c.id = cm.conversation_id
    where cm.conversation_id = ${conversationId}::uuid and cm.user_id = ${uid}::uuid`;
  if (!m) throw forbidden('Kamu bukan anggota percakapan ini');
  return m;
}

export async function requireAdmin(conversationId: string, uid: string): Promise<Row> {
  const m = await requireMember(conversationId, uid);
  if (m.kind !== 'group') throw forbidden('Hanya untuk grup');
  if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('Hanya admin grup yang boleh');
  return m;
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [r] = await sql`
    select 1 as x from blocks
    where (blocker_id = ${a}::uuid and blocked_id = ${b}::uuid)
       or (blocker_id = ${b}::uuid and blocked_id = ${a}::uuid)
    limit 1`;
  return !!r;
}

/** Ambil pesan + pastikan pemanggil anggota percakapannya. */
export async function requireMessage(messageId: string, uid: string): Promise<Row> {
  const [m] = await sql`
    select id, conversation_id, sender_id, kind, created_at, deleted_at
    from messages where id = ${messageId}::uuid`;
  if (!m) throw notFound('Pesan tidak ditemukan');
  await requireMember(m.conversation_id, uid);
  return m;
}

/** Batas waktu dari admin: pengguna masih bisa membaca, tetapi tidak bisa mengirim chat / posting / menelepon. */
export async function assertCanSend(uid: string): Promise<void> {
  const [u] = await sql`
    select restricted_until, restriction_reason from users
    where id = ${uid}::uuid and restricted_until is not null and restricted_until > now()`;
  if (u) {
    throw new HttpError(403, 'Kamu dibatasi mengirim pesan untuk sementara.', {
      code: 'send_limited',
      until: u.restricted_until,
      reason: u.restriction_reason ?? null,
    });
  }
}
