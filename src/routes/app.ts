import { sql } from '../db';
import { HttpError, badRequest, created, notFound, readJson } from '../http';
import type { Router } from '../router';
import * as v from '../validate';

/** Endpoint untuk aplikasi Flutter: pengumuman, status server, hitung unduhan, dan laporan pengguna. */
export function registerApp(r: Router) {
  // Publik: dipanggil aplikasi saat dibuka (dan berkala). ?version=1.0.0 -> server memberi tahu apakah harus update.
  r.add('GET', '/app/notice', async ({ query }) => {
    const version = (query.get('version') ?? '').trim();
    const [srv, rows, rel] = await Promise.all([
      sql`select status, message, updated_at from server_status where id = 1`,
      sql`select id, kind, severity, title, body, force_update, min_version, created_at, expires_at
          from announcements where active and (expires_at is null or expires_at > now())
          order by created_at desc limit 10`,
      sql`select id, version, notes, force, parts, size_bytes, sha256, external_url, created_at
          from app_releases where active order by created_at desc limit 1`,
    ]);
    const cmp = (a: string, b: string) => {
      const x = a.split('.').map(Number), y = b.split('.').map(Number);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    };
    const notices = rows.map((n) => ({
      id: n.id, kind: n.kind, severity: n.severity, title: n.title, body: n.body,
      forceUpdate: !!n.force_update && !!n.min_version && !!version && /^\d+(\.\d+)*$/.test(version) && cmp(version, n.min_version) < 0,
      minVersion: n.min_version, createdAt: n.created_at, expiresAt: n.expires_at,
    }));
    // Rilis terbaru: aplikasi membandingkan versinya dengan ini. force=true + versi lebih lama -> update wajib.
    const r0 = rel[0];
    const valid = /^\d+(\.\d+)*$/.test(version);
    const updateAvailable = !!r0 && valid && cmp(version, r0.version) < 0;
    const release = r0
      ? {
          id: r0.id, version: r0.version, notes: r0.notes, force: !!r0.force,
          parts: r0.parts, size: Number(r0.size_bytes), sha256: r0.sha256, externalUrl: r0.external_url,
          createdAt: r0.created_at, updateAvailable,
        }
      : null;
    return {
      server: { status: srv[0]?.status ?? 'ok', message: srv[0]?.message ?? '', updatedAt: srv[0]?.updated_at ?? null },
      mustUpdate: notices.some((n) => n.forceUpdate) || (updateAvailable && !!r0?.force),
      release,
      notices,
    };
  }, { public: true });

  // Publik: panggil SEKALI saat aplikasi pertama kali dibuka. deviceId = UUID acak yang dibuat aplikasi (bukan IMEI).
  r.add('POST', '/app/install', async ({ req }) => {
    const b = await readJson(req, 2000);
    const deviceId = v.str(b.deviceId, 'deviceId', 8, 64);
    if (!/^[A-Za-z0-9_-]+$/.test(deviceId)) throw badRequest('deviceId tidak valid');
    const platform = v.oneOf(b.platform ?? 'android', 'platform', ['android', 'ios', 'web', 'other'] as const);
    const appVersion = v.optStr(b.appVersion, 'appVersion', 20) ?? null;
    const [row] = await sql`
      insert into app_installs (device_id, platform, app_version) values (${deviceId}, ${platform}, ${appVersion})
      on conflict (device_id) do nothing returning device_id`;
    return created({ ok: true, counted: !!row });
  }, { public: true });

  // Pengguna melaporkan akun lain (spam / penipuan / pelecehan). Muncul di tab "Mencurigakan" dashboard admin.
  r.add('POST', '/reports', async ({ req, uid }) => {
    const b = await readJson(req, 4000);
    const targetId = v.uuid(b.userId, 'userId');
    if (targetId === uid) throw badRequest('Tidak bisa melaporkan diri sendiri');
    const category = v.oneOf(b.category, 'Kategori', ['spam', 'penipuan', 'pelecehan', 'lainnya'] as const);
    const note = v.optStr(b.note, 'Catatan', 500) ?? '';
    const [t] = await sql`select id from users where id = ${targetId}::uuid`;
    if (!t) throw notFound('Pengguna tidak ditemukan');
    const [dayCount] = await sql`select count(*)::int as n from user_reports where reporter_id = ${uid}::uuid and created_at > now() - interval '24 hours'`;
    if ((dayCount?.n ?? 0) >= 20) throw new HttpError(429, 'Terlalu banyak laporan hari ini');
    await sql`
      insert into user_reports (reporter_id, target_id, category, note) values (${uid}::uuid, ${targetId}::uuid, ${category}, ${note})
      on conflict (reporter_id, target_id) where reporter_id is not null
      do update set category = excluded.category, note = excluded.note, created_at = now()`;
    return created({ ok: true });
  });
}
