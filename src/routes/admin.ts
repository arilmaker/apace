import type { IncomingMessage } from 'node:http';
import { checkAdminLogin, issueAdminToken, requireAdmin, ADMIN_TOKEN_TTL } from '../adminAuth';
import { del, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { sql } from '../db';
import { emitToUsers } from '../events';
import { explainSmtpError, sealPassword, verifySmtp } from '../gmailPool';
import { unseal } from '../secrets';
import { HttpError, badRequest, conflict, created, notFound, readBody, readJson } from '../http';
import type { Ctx, Handler, Router } from '../router';
import * as v from '../validate';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const ONLINE_SECONDS = 40;

// Ambang deteksi aktivitas mencurigakan (bisa disesuaikan).
const T = { msgPerHour: 60, convsPerDay: 15, blockedBy: 3, newAccountMsgs: 30 };

const CATEGORIES = ['spam', 'penipuan', 'pelecehan', 'aktivitas_aneh', 'lainnya'] as const;
const clientKey = (req: IncomingMessage) =>
  String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim().slice(0, 64);

function userLabel(u: { username?: string | null; email?: string | null }) {
  return u.username ? `@${u.username}` : String(u.email ?? '?');
}

function moderationState(u: Record<string, any>) {
  const now = Date.now();
  const disUntil = u.disabled_until ? new Date(u.disabled_until).getTime() : 0;
  const limUntil = u.restricted_until ? new Date(u.restricted_until).getTime() : 0;
  if (u.disabled_permanent) return { state: 'permanent', until: null };
  if (disUntil > now) return { state: 'disabled', until: u.disabled_until };
  if (limUntil > now) return { state: 'limited', until: u.restricted_until };
  return { state: 'ok', until: null };
}

const userCard = (u: Record<string, any>) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  displayName: u.display_name,
  emoji: u.avatar_emoji,
  color: u.avatar_color,
  createdAt: u.created_at,
  lastSeenAt: u.last_seen_at,
  reason: u.restriction_reason ?? null,
  category: u.restriction_category ?? null,
  ...moderationState(u),
});

export function registerAdmin(r: Router) {
  /** Semua route admin bersifat "publik" bagi router user; keamanannya lewat token admin terpisah. */
  const guarded = (h: Handler): Handler => async (c: Ctx) => {
    c.uid = requireAdmin(c.req);
    return h(c);
  };
  const add = (method: string, path: string, h: Handler) => r.add(method, path, guarded(h), { public: true });

  // ───────────── Login ─────────────
  r.add('POST', '/admin/login', async ({ req }) => {
    const b = await readJson(req, 10_000);
    const username = v.str(b.username, 'Username', 1, 60);
    const password = v.str(b.password, 'Password', 1, 200);
    const key = `admin:${clientKey(req)}`;

    const [att] = await sql`select (locked_until is not null and locked_until > now()) as locked,
      extract(epoch from (locked_until - now()))::int as wait from admin_attempts where key = ${key}`;
    if (att?.locked) {
      throw new HttpError(429, `Terlalu banyak percobaan. Coba lagi ${Math.ceil((att.wait ?? 60) / 60)} menit lagi.`, { retryAfter: att.wait });
    }

    if (!checkAdminLogin(username, password)) {
      await sql`
        insert into admin_attempts (key, fails, updated_at) values (${key}, 1, now())
        on conflict (key) do update set
          fails = case when admin_attempts.fails + 1 >= ${MAX_FAILS} then 0 else admin_attempts.fails + 1 end,
          locked_until = case when admin_attempts.fails + 1 >= ${MAX_FAILS}
                              then now() + make_interval(mins => ${LOCK_MINUTES}) else admin_attempts.locked_until end,
          updated_at = now()`;
      throw new HttpError(401, 'Username atau password salah.');
    }
    await sql`delete from admin_attempts where key = ${key}`;
    return { token: issueAdminToken(username), username, expiresIn: ADMIN_TOKEN_TTL };
  }, { public: true });

  add('GET', '/admin/me', async ({ uid }) => ({ username: uid }));

  // ───────────── Statistik (4 kotak + grafik) ─────────────
  add('GET', '/admin/stats', async () => {
    const [gm, us, mod, week, prev, days, sig, srv] = await Promise.all([
      sql`select count(*) filter (where enabled and status = 'active')::int as active,
                 count(*)::int as total,
                 count(*) filter (where status = 'error')::int as errors,
                 coalesce(sum(case when sent_day = current_date then sent_today else 0 end), 0)::int as sent_today
          from gmail_accounts`,
      sql`select count(*)::int as total,
                 count(*) filter (where last_seen_at > now() - make_interval(secs => ${ONLINE_SECONDS}))::int as online,
                 count(*) filter (where created_at > now() - interval '24 hours')::int as new_today
          from users`,
      sql`select count(*) filter (where disabled_permanent)::int as permanent,
                 count(*) filter (where not disabled_permanent and disabled_until > now())::int as temporary,
                 count(*) filter (where not disabled_permanent and coalesce(disabled_until, 'epoch') <= now() and restricted_until > now())::int as limited
          from users`,
      sql`select count(*)::int as n from app_installs
          where (created_at at time zone 'Asia/Jakarta') >= date_trunc('week', now() at time zone 'Asia/Jakarta')`,
      sql`select count(*)::int as n from app_installs
          where (created_at at time zone 'Asia/Jakarta') >= date_trunc('week', now() at time zone 'Asia/Jakarta') - interval '7 days'
            and (created_at at time zone 'Asia/Jakarta') <  date_trunc('week', now() at time zone 'Asia/Jakarta')`,
      sql`with d as (
            select generate_series(date_trunc('week', now() at time zone 'Asia/Jakarta'),
                                   date_trunc('week', now() at time zone 'Asia/Jakarta') + interval '6 days', interval '1 day') as day)
          select to_char(d.day, 'YYYY-MM-DD') as date,
                 (select count(*)::int from app_installs i where (i.created_at at time zone 'Asia/Jakarta')::date = d.day::date) as installs,
                 (select count(*)::int from users u where (u.created_at at time zone 'Asia/Jakarta')::date = d.day::date) as signups,
                 (d.day::date > (now() at time zone 'Asia/Jakarta')::date) as future
          from d order by d.day`,
      sql`select (now() at time zone 'Asia/Jakarta')::date - g.d as day,
                 (select count(*)::int from users u where (u.created_at at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date - g.d) as n
          from generate_series(13, 0, -1) as g(d) order by 1`,
      sql`select status, message, updated_at from server_status where id = 1`,
    ]);
    const g = gm[0] ?? {}, u = us[0] ?? {}, m = mod[0] ?? {};
    const thisWeek = week[0]?.n ?? 0, lastWeek = prev[0]?.n ?? 0;
    return {
      serverTime: new Date().toISOString(),
      gmail: { active: g.active ?? 0, total: g.total ?? 0, errors: g.errors ?? 0, sentToday: g.sent_today ?? 0 },
      users: { total: u.total ?? 0, online: u.online ?? 0, newToday: u.new_today ?? 0, signups14: sig.map((x) => x.n) },
      moderation: {
        permanent: m.permanent ?? 0, temporary: m.temporary ?? 0, limited: m.limited ?? 0,
        total: (m.permanent ?? 0) + (m.temporary ?? 0) + (m.limited ?? 0),
      },
      downloads: {
        week: thisWeek, lastWeek,
        change: lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null,
        days: days.map((d) => ({ date: d.date, installs: d.installs, signups: d.signups, future: d.future })),
      },
      server: srv[0] ?? { status: 'ok', message: '' },
    };
  });

  // ───────────── Gmail pool ─────────────
  const gmailOut = (g: Record<string, any>) => ({
    id: g.id, email: g.email, host: g.smtp_host, port: g.smtp_port, enabled: g.enabled, status: g.status,
    sentTotal: g.sent_total, sentToday: g.sent_day && new Date(g.sent_day).toDateString() === new Date().toDateString() ? g.sent_today : 0,
    failCount: g.fail_count, lastError: g.last_error, lastUsedAt: g.last_used_at, lastCheckedAt: g.last_checked_at, createdAt: g.created_at,
  });

  add('GET', '/admin/gmail', async () => {
    const rows = await sql`select * from gmail_accounts order by created_at desc`;
    return { accounts: rows.map(gmailOut) };
  });

  // Tambah Gmail: validasi -> cek login SMTP -> simpan terenkripsi.
  add('POST', '/admin/gmail', async ({ req }) => {
    const b = await readJson(req, 10_000);
    const email = v.email(b.email);
    const pass = v.str(b.appPassword, 'App Password', 8, 64).replace(/\s+/g, '');
    const host = v.str(b.host ?? 'smtp.gmail.com', 'Host SMTP', 3, 100).toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) throw badRequest('Host SMTP tidak valid');
    const port = v.int(b.port ?? 587, 'Port', 1, 65535);
    if (![465, 587].includes(port)) throw badRequest('Port harus 587 (STARTTLS) atau 465 (SSL)');
    if (pass.length < 12) throw badRequest('App Password biasanya 16 karakter. Cek lagi tanpa spasi.', { code: 'short_password' });

    const [dup] = await sql`select 1 as x from gmail_accounts where email = ${email}`;
    if (dup) throw conflict('Gmail ini sudah ada di daftar', { code: 'duplicate' });

    try {
      await verifySmtp({ user: email, pass, host, port });
    } catch (e) {
      const { code, message } = explainSmtpError(e);
      throw new HttpError(422, message, { code });
    }
    const [row] = await sql`
      insert into gmail_accounts (email, secret_enc, smtp_host, smtp_port, last_checked_at)
      values (${email}, ${sealPassword(pass)}, ${host}, ${port}, now()) returning *`;
    return created({ ok: true, account: gmailOut(row) });
  });

  // Cek ulang login akun yang sudah tersimpan (juga memulihkan status 'error').
  add('POST', '/admin/gmail/:id/test', async ({ params }) => {
    const id = v.uuid(params.id, 'id');
    const [a] = await sql`select * from gmail_accounts where id = ${id}::uuid`;
    if (!a) throw notFound('Gmail tidak ditemukan');
    try {
      await verifySmtp({ user: a.email, pass: unseal(a.secret_enc), host: a.smtp_host, port: a.smtp_port });
    } catch (e) {
      const { code, message } = explainSmtpError(e);
      await sql`update gmail_accounts set status = 'error', last_error = ${message}, last_checked_at = now() where id = ${id}::uuid`;
      throw new HttpError(422, message, { code });
    }
    const [row] = await sql`
      update gmail_accounts set status = 'active', fail_count = 0, last_error = null, last_checked_at = now()
      where id = ${id}::uuid returning *`;
    return { ok: true, account: gmailOut(row) };
  });

  add('PATCH', '/admin/gmail/:id', async ({ req, params }) => {
    const id = v.uuid(params.id, 'id');
    const enabled = v.bool((await readJson(req, 2000)).enabled, 'enabled');
    const [row] = await sql`update gmail_accounts set enabled = ${enabled} where id = ${id}::uuid returning *`;
    if (!row) throw notFound('Gmail tidak ditemukan');
    return { ok: true, account: gmailOut(row) };
  });

  add('DELETE', '/admin/gmail/:id', async ({ params }) => {
    const id = v.uuid(params.id, 'id');
    await sql`delete from gmail_accounts where id = ${id}::uuid`;
    return { ok: true };
  });

  // ───────────── Deteksi aktivitas mencurigakan ─────────────
  add('GET', '/admin/suspicious', async () => {
    const rows = await sql`
      with m as (
        select sender_id,
               count(*) filter (where created_at > now() - interval '1 hour')::int as msg_1h,
               count(*)::int as msg_24h,
               count(distinct conversation_id)::int as convs_24h
        from messages where created_at > now() - interval '24 hours' and kind <> 'vote' group by sender_id),
      b as (select blocked_id, count(*)::int as blocked_by from blocks group by blocked_id),
      rp as (
        select target_id, count(*)::int as reports,
               (array_agg(category order by created_at desc))[1] as last_category,
               (array_agg(note order by created_at desc))[1] as last_note
        from user_reports where created_at > now() - interval '30 days' group by target_id)
      select u.id, u.email, u.username, u.display_name, u.avatar_emoji, u.avatar_color, u.created_at, u.last_seen_at,
             u.disabled_permanent, u.disabled_until, u.restricted_until, u.restriction_reason, u.restriction_category,
             coalesce(m.msg_1h, 0) as msg_1h, coalesce(m.msg_24h, 0) as msg_24h, coalesce(m.convs_24h, 0) as convs_24h,
             coalesce(b.blocked_by, 0) as blocked_by, coalesce(rp.reports, 0) as reports,
             rp.last_category, rp.last_note,
             (u.created_at > now() - interval '24 hours') as is_new
      from users u
      left join m on m.sender_id = u.id
      left join b on b.blocked_id = u.id
      left join rp on rp.target_id = u.id
      where not u.disabled_permanent
        and not (u.disabled_until is not null and u.disabled_until > now())
        and (coalesce(m.msg_1h, 0) >= ${T.msgPerHour} or coalesce(m.convs_24h, 0) >= ${T.convsPerDay}
             or coalesce(b.blocked_by, 0) >= ${T.blockedBy} or coalesce(rp.reports, 0) >= 1
             or (u.created_at > now() - interval '24 hours' and coalesce(m.msg_24h, 0) >= ${T.newAccountMsgs}))
      limit 200`;

    const items = rows.map((x) => {
      const signals: { key: string; label: string; weight: number }[] = [];
      if (x.msg_1h >= T.msgPerHour) signals.push({ key: 'burst', label: `${x.msg_1h} pesan dalam 1 jam`, weight: Math.min(40, 20 + Math.floor(x.msg_1h / 10)) });
      if (x.convs_24h >= T.convsPerDay) signals.push({ key: 'fanout', label: `Kirim ke ${x.convs_24h} chat berbeda (24 jam)`, weight: 25 });
      if (x.blocked_by >= T.blockedBy) signals.push({ key: 'blocked', label: `Diblokir ${x.blocked_by} orang`, weight: Math.min(30, 10 * x.blocked_by) });
      if (x.reports >= 1) signals.push({ key: 'reports', label: `${x.reports} laporan pengguna${x.last_category ? ` (${x.last_category})` : ''}`, weight: Math.min(45, 20 * x.reports) });
      if (x.is_new && x.msg_24h >= T.newAccountMsgs) signals.push({ key: 'newbie', label: `Akun baru, ${x.msg_24h} pesan hari ini`, weight: 20 });
      const score = Math.min(100, signals.reduce((s, g) => s + g.weight, 0));
      return {
        ...userCard(x),
        score,
        level: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
        signals,
        stats: { msg1h: x.msg_1h, msg24h: x.msg_24h, convs24h: x.convs_24h, blockedBy: x.blocked_by, reports: x.reports },
        lastNote: x.last_note || null,
      };
    });
    items.sort((a, b) => b.score - a.score);
    return { items: items.slice(0, 50), thresholds: T };
  });

  // Cari akun manual (email / @username)
  add('GET', '/admin/users/search', async ({ query }) => {
    const q = (query.get('q') ?? '').trim().toLowerCase().replace(/^@/, '').slice(0, 60);
    if (q.length < 2) return { users: [] };
    const like = `%${q.replace(/[%_\\]/g, '')}%`;
    const rows = await sql`
      select id, email, username, display_name, avatar_emoji, avatar_color, created_at, last_seen_at,
             disabled_permanent, disabled_until, restricted_until, restriction_reason, restriction_category
      from users where email ilike ${like} or username ilike ${like} or display_name ilike ${like}
      order by last_seen_at desc nulls last limit 20`;
    return { users: rows.map(userCard) };
  });

  // Daftar akun yang sedang dibatasi / dinonaktifkan
  add('GET', '/admin/restricted', async () => {
    const rows = await sql`
      select id, email, username, display_name, avatar_emoji, avatar_color, created_at, last_seen_at,
             disabled_permanent, disabled_until, restricted_until, restriction_reason, restriction_category
      from users
      where disabled_permanent or disabled_until > now() or restricted_until > now()
      order by disabled_permanent desc, coalesce(disabled_until, restricted_until) desc limit 200`;
    return { users: rows.map(userCard) };
  });

  add('GET', '/admin/moderation-log', async () => {
    const rows = await sql`
      select id, user_id, user_label, action, category, reason, until_at, admin, created_at
      from moderation_log order by created_at desc limit 40`;
    return {
      log: rows.map((l) => ({
        id: l.id, userId: l.user_id, user: l.user_label, action: l.action, category: l.category,
        reason: l.reason, until: l.until_at, admin: l.admin, createdAt: l.created_at,
      })),
    };
  });

  // ───────────── Tindakan moderasi ─────────────
  async function target(id: string) {
    const [u] = await sql`select id, email, username from users where id = ${id}::uuid`;
    if (!u) throw notFound('Akun tidak ditemukan');
    return u;
  }
  const log = (u: any, action: string, category: string | null, reason: string, until: Date | null, admin: string) =>
    sql`insert into moderation_log (user_id, user_label, action, category, reason, until_at, admin)
        values (${u.id}::uuid, ${userLabel(u)}, ${action}, ${category}, ${reason}, ${until ? until.toISOString() : null}, ${admin})`;

  // Batas waktu: tidak bisa kirim chat selama N jam
  add('POST', '/admin/users/:id/limit', async ({ req, params, uid: admin }) => {
    const id = v.uuid(params.id, 'id');
    const b = await readJson(req, 5000);
    const hours = v.int(b.hours, 'Jam', 1, 24 * 30);
    const category = v.oneOf(b.category ?? 'spam', 'Kategori', CATEGORIES);
    const reason = v.optStr(b.reason, 'Alasan', 300) ?? '';
    const u = await target(id);
    const until = new Date(Date.now() + hours * 3600_000);
    await sql`update users set restricted_until = ${until.toISOString()}, restriction_reason = ${reason || category}, restriction_category = ${category}
              where id = ${id}::uuid`;
    await log(u, 'limit', category, reason, until, admin);
    await emitToUsers([id], 'account.limited', { until: until.toISOString(), reason: reason || category });
    return { ok: true, until: until.toISOString() };
  });

  // Nonaktifkan: mode 'spam' (sementara, N hari) atau 'permanent'
  add('POST', '/admin/users/:id/disable', async ({ req, params, uid: admin }) => {
    const id = v.uuid(params.id, 'id');
    const b = await readJson(req, 5000);
    const mode = v.oneOf(b.mode, 'Mode', ['spam', 'permanent'] as const);
    const category = v.oneOf(b.category ?? (mode === 'spam' ? 'spam' : 'penipuan'), 'Kategori', CATEGORIES);
    const reason = v.optStr(b.reason, 'Alasan', 300) ?? '';
    const u = await target(id);
    let until: Date | null = null;
    if (mode === 'spam') {
      until = new Date(Date.now() + v.int(b.days ?? 3, 'Hari', 1, 365) * 86400_000);
      await sql`update users set disabled_permanent = false, disabled_until = ${until.toISOString()},
                  restriction_reason = ${reason || category}, restriction_category = ${category} where id = ${id}::uuid`;
    } else {
      await sql`update users set disabled_permanent = true, disabled_until = null,
                  restriction_reason = ${reason || category}, restriction_category = ${category} where id = ${id}::uuid`;
    }
    await log(u, mode === 'spam' ? 'disable_spam' : 'disable_permanent', category, reason, until, admin);
    return { ok: true, permanent: mode === 'permanent', until: until?.toISOString() ?? null };
  });

  // Pulihkan akun (cabut semua pembatasan)
  add('POST', '/admin/users/:id/restore', async ({ params, uid: admin }) => {
    const id = v.uuid(params.id, 'id');
    const u = await target(id);
    await sql`update users set disabled_permanent = false, disabled_until = null, restricted_until = null,
                restriction_reason = null, restriction_category = null where id = ${id}::uuid`;
    await log(u, 'restore', null, 'Dipulihkan oleh admin', null, admin);
    await emitToUsers([id], 'account.restored', {});
    return { ok: true };
  });

  // ───────────── Peringatan / update ─────────────
  const noticeOut = (n: Record<string, any>) => ({
    id: n.id, kind: n.kind, severity: n.severity, title: n.title, body: n.body,
    forceUpdate: n.force_update, minVersion: n.min_version, active: n.active,
    createdAt: n.created_at, expiresAt: n.expires_at,
  });

  add('GET', '/admin/notices', async () => {
    const [rows, srv] = await Promise.all([
      sql`select * from announcements order by created_at desc limit 50`,
      sql`select status, message, updated_at from server_status where id = 1`,
    ]);
    return { notices: rows.map(noticeOut), server: srv[0] ?? { status: 'ok', message: '' } };
  });

  add('POST', '/admin/notices', async ({ req }) => {
    const b = await readJson(req, 10_000);
    const kind = v.oneOf(b.kind, 'Jenis', ['update', 'maintenance', 'info', 'feature', 'warning'] as const);
    const severity = v.oneOf(b.severity ?? 'info', 'Tingkat', ['info', 'warning', 'critical'] as const);
    const title = v.str(b.title, 'Judul', 3, 80);
    const body = v.optStr(b.body, 'Isi', 1000) ?? '';
    const force = v.optBool(b.forceUpdate, 'forceUpdate') ?? false;
    const minVersion = v.optStr(b.minVersion, 'Versi minimum', 20) ?? null;
    if (minVersion && !/^\d+(\.\d+){0,3}$/.test(minVersion)) throw badRequest('Versi minimum harus seperti 1.2.0');
    const hours = b.expiresInHours === undefined || b.expiresInHours === null || b.expiresInHours === '' ? null : v.int(b.expiresInHours, 'Tampil (jam)', 1, 24 * 90);
    const expires = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
    const [row] = await sql`
      insert into announcements (kind, severity, title, body, force_update, min_version, expires_at)
      values (${kind}, ${severity}, ${title}, ${body}, ${force}, ${minVersion}, ${expires}) returning *`;
    return created({ ok: true, notice: noticeOut(row) });
  });

  add('PATCH', '/admin/notices/:id', async ({ req, params }) => {
    const id = v.uuid(params.id, 'id');
    const active = v.bool((await readJson(req, 2000)).active, 'active');
    const [row] = await sql`update announcements set active = ${active} where id = ${id}::uuid returning *`;
    if (!row) throw notFound('Peringatan tidak ditemukan');
    return { ok: true, notice: noticeOut(row) };
  });

  add('DELETE', '/admin/notices/:id', async ({ params }) => {
    await sql`delete from announcements where id = ${v.uuid(params.id, 'id')}::uuid`;
    return { ok: true };
  });

  // Status server: ok / degraded (gangguan) / maintenance / down
  add('PUT', '/admin/server-status', async ({ req }) => {
    const b = await readJson(req, 5000);
    const status = v.oneOf(b.status, 'Status', ['ok', 'degraded', 'maintenance', 'down'] as const);
    const message = v.optStr(b.message, 'Pesan', 300) ?? '';
    const [row] = await sql`
      insert into server_status (id, status, message, updated_at) values (1, ${status}, ${message}, now())
      on conflict (id) do update set status = excluded.status, message = excluded.message, updated_at = now()
      returning status, message, updated_at`;
    return { ok: true, server: row };
  });

  // ───────── Rilis aplikasi (update wajib) ─────────
  const releaseOut = (r: Record<string, any>) => ({
    id: r.id, version: r.version, notes: r.notes, force: !!r.force, active: !!r.active,
    size: Number(r.size_bytes), parts: Array.isArray(r.parts) ? r.parts.length : 0,
    sha256: r.sha256, externalUrl: r.external_url, createdAt: r.created_at,
  });

  add('GET', '/admin/releases', async () => {
    const rows = await sql`select * from app_releases order by created_at desc limit 30`;
    return { releases: rows.map(releaseOut) };
  });

  // Satu potongan APK (maks 4 MB). Dashboard memanggil ini berulang, lalu POST /admin/releases.
  add('POST', '/admin/releases/chunk', async ({ req, query }) => {
    const idx = v.int(Number(query.get('idx')), 'idx', 0, 999);
    const buf = await readBody(req, 4 * 1024 * 1024);
    if (!buf.length) throw badRequest('Potongan kosong');
    let blob;
    try {
      blob = await put(`releases/${randomUUID()}-${idx}.part`, buf, {
        access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true,
      });
    } catch (e) {
      console.error('[R1ZCHATID] simpan potongan rilis gagal', e);
      const detail = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 160);
      throw new HttpError(502, `Gagal menyimpan ke Vercel Blob (${detail}). Pastikan store Blob Public dan BLOB_READ_WRITE_TOKEN terpasang.`);
    }
    return { ok: true, url: blob.url, size: buf.length };
  });

  add('POST', '/admin/releases', async ({ req }) => {
    const b = await readJson(req, 100_000);
    const version = v.str(b.version, 'Versi', 1, 20);
    if (!/^\d+(\.\d+){0,3}$/.test(version)) throw badRequest('Versi harus seperti 1.0.2');
    const notes = v.optStr(b.notes, 'Catatan', 2000) ?? '';
    const force = v.optBool(b.force, 'force') ?? true;
    const externalUrl = v.optStr(b.externalUrl, 'Link unduhan', 500) ?? null;
    if (externalUrl && !/^https:\/\//.test(externalUrl)) throw badRequest('Link unduhan harus diawali https://');
    const partsIn = Array.isArray(b.parts) ? b.parts : [];
    if (partsIn.length > 600) throw badRequest('Terlalu banyak potongan');
    const parts = partsIn.map((p: any) => {
      const url = String(p?.url ?? '');
      let host = '';
      try { host = new URL(url).hostname; } catch { /* abaikan */ }
      if (!url.startsWith('https://') || !host.endsWith('.public.blob.vercel-storage.com')) throw badRequest('URL potongan tidak valid');
      return { url, size: Number(p?.size) || 0 };
    });
    if (!parts.length && !externalUrl) throw badRequest('Unggah APK atau isi link unduhan');
    const size = parts.reduce((a: number, p: { size: number }) => a + p.size, 0);
    const sha = v.optStr(b.sha256, 'sha256', 64) ?? null;
    if (sha && !/^[0-9a-f]{64}$/i.test(sha)) throw badRequest('sha256 tidak valid');
    const [dup] = await sql`select id from app_releases where version = ${version}`;
    if (dup) throw conflict('Versi ini sudah pernah dirilis. Pakai nomor versi baru.');
    const [row] = await sql`
      insert into app_releases (version, notes, force, parts, size_bytes, sha256, external_url)
      values (${version}, ${notes}, ${force}, ${JSON.stringify(parts)}::jsonb, ${size}, ${sha?.toLowerCase() ?? null}, ${externalUrl})
      returning *`;
    return created({ ok: true, release: releaseOut(row) });
  });

  add('PATCH', '/admin/releases/:id', async ({ req, params }) => {
    const id = v.uuid(params.id, 'id');
    const b = await readJson(req, 2000);
    const active = v.optBool(b.active, 'active');
    const force = v.optBool(b.force, 'force');
    const [row] = await sql`
      update app_releases set active = coalesce(${active}::boolean, active), force = coalesce(${force}::boolean, force)
      where id = ${id}::uuid returning *`;
    if (!row) throw notFound('Rilis tidak ditemukan');
    return { ok: true, release: releaseOut(row) };
  });

  add('DELETE', '/admin/releases/:id', async ({ params }) => {
    const id = v.uuid(params.id, 'id');
    const [row] = await sql`delete from app_releases where id = ${id}::uuid returning parts`;
    if (row && Array.isArray(row.parts) && row.parts.length) {
      try { await del(row.parts.map((p: { url: string }) => p.url)); } catch { /* file mungkin sudah hilang */ }
    }
    return { ok: true };
  });
}
