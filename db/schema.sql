-- R1ZCHATID — skema database (Neon Postgres). Aman dijalankan berulang kali.
-- Jalankan di Neon SQL Editor sekali saat setup, dan lagi setiap ada pembaruan versi.

create extension if not exists pgcrypto;

-- ───────────── Akun ─────────────
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  username       text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name   text,
  about          text not null default 'Hai! Aku pakai R1ZCHATID 💬',
  avatar_emoji   text not null default '😎',
  avatar_color   text not null default '#FFD43B',
  public_key     text,                                  -- X25519 (base64url). Private key TIDAK pernah ke server.
  show_last_seen boolean not null default true,
  read_receipts  boolean not null default true,         -- centang biru
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists otp_codes (
  email             text primary key,
  code_hash         text not null,                      -- HMAC, kode asli tidak disimpan
  expires_at        timestamptz not null,
  attempts          int not null default 0,
  sent_count        int not null default 1,
  window_started_at timestamptz not null default now(),
  last_sent_at      timestamptz not null default now()
);

create table if not exists blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index if not exists blocks_blocked_idx on blocks (blocked_id);

-- ───────────── Percakapan ─────────────
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('direct','group')),
  title       text,
  icon_emoji  text not null default '👥',
  icon_color  text not null default '#4DABF7',
  direct_key  text unique,                              -- "idA:idB" (terurut) supaya chat pribadi tidak dobel
  ttl_seconds int check (ttl_seconds is null or ttl_seconds > 0),  -- pesan hilang otomatis
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  role            text not null default 'member' check (role in ('owner','admin','member')),
  pinned          boolean not null default false,
  archived        boolean not null default false,
  muted           boolean not null default false,
  hidden          boolean not null default false,       -- "hapus chat" (hilang dari daftar sampai ada pesan baru)
  cleared_at      timestamptz,                          -- riwayat sebelum waktu ini disembunyikan untuk saya
  last_read_at    timestamptz,                          -- batas baca pribadi (badge belum dibaca)
  typing_at       timestamptz,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists cm_user_idx on conversation_members (user_id);

-- ───────────── Pesan (hanya ciphertext) ─────────────
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references users(id) on delete cascade,
  kind            text not null default 'text'
                  check (kind in ('text','image','video','audio','document','sticker','poll','vote')),
  ciphertext      text not null,
  nonce           text not null,
  sender_key      text not null,                        -- public key pengirim saat mengirim
  reply_to        uuid references messages(id) on delete set null,
  expires_at      timestamptz,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages (conversation_id, created_at desc);
create index if not exists messages_expires_idx on messages (expires_at) where expires_at is not null;

-- Kunci isi pesan, dibungkus (dienkripsi) khusus untuk tiap anggota.
create table if not exists message_keys (
  message_id  uuid not null references messages(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  wrapped_key text not null,
  wrap_nonce  text not null,
  primary key (message_id, user_id)
);

create table if not exists message_receipts (
  message_id   uuid not null references messages(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  delivered_at timestamptz,
  read_at      timestamptz,
  primary key (message_id, user_id)
);

create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  primary key (message_id, user_id)
);

create table if not exists message_hidden (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  primary key (message_id, user_id)
);

create table if not exists message_stars (
  message_id uuid not null references messages(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  primary key (message_id, user_id)
);

-- ───────────── Antrean event (pengganti WebSocket) ─────────────
create table if not exists events (
  id         bigserial primary key,
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index if not exists events_user_idx on events (user_id, id);

-- ───────────── Status 24 jam (terenkripsi) ─────────────
create table if not exists statuses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  ciphertext text not null,
  nonce      text not null,
  sender_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists statuses_user_idx on statuses (user_id, created_at desc);

create table if not exists status_keys (
  status_id   uuid not null references statuses(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  wrapped_key text not null,
  wrap_nonce  text not null,
  primary key (status_id, user_id)
);
create index if not exists status_keys_user_idx on status_keys (user_id);

create table if not exists status_views (
  status_id uuid not null references statuses(id) on delete cascade,
  viewer_id uuid not null references users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);

-- ───────────── Panggilan ─────────────
create table if not exists calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  caller_id       uuid not null references users(id) on delete cascade,
  callee_id       uuid not null references users(id) on delete cascade,
  kind            text not null check (kind in ('voice','video')),
  status          text not null default 'ringing'
                  check (status in ('ringing','answered','declined','missed','canceled','ended')),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz
);
create index if not exists calls_caller_idx on calls (caller_id, created_at desc);
create index if not exists calls_callee_idx on calls (callee_id, created_at desc);

-- ───────────── Media terenkripsi (Vercel Blob) ─────────────
create table if not exists media_objects (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  url        text not null,
  size_bytes int not null,
  purpose    text not null default 'chat' check (purpose in ('chat','status','channel')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists media_owner_idx on media_objects (owner_id);
create index if not exists media_expires_idx on media_objects (expires_at);

-- Untuk database lama (dibuat sebelum fitur video/audio/dokumen/polling/channel): perbarui constraint.
alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text','image','video','audio','document','sticker','poll','vote'));
alter table media_objects drop constraint if exists media_objects_purpose_check;
alter table media_objects add constraint media_objects_purpose_check check (purpose in ('chat','status','channel'));

-- Suara polling = pesan terenkripsi bertipe 'vote' yang menunjuk ke pesan 'poll' lewat reply_to.
create index if not exists messages_votes_idx on messages (reply_to) where kind = 'vote';

-- ───────────── Channel (siaran satu arah, PUBLIK dan tidak dienkripsi E2EE) ─────────────
create table if not exists channels (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  name        text not null,
  handle      text unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  description text not null default '',
  icon_emoji  text not null default '📢',
  icon_color  text not null default '#FF6B6B',
  created_at  timestamptz not null default now()
);
create index if not exists channels_owner_idx on channels (owner_id);

create table if not exists channel_follows (
  channel_id  uuid not null references channels(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  followed_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists channel_follows_user_idx on channel_follows (user_id);

create table if not exists channel_posts (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  author_id  uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('text','image','video','audio','document')),
  body       text not null default '',
  media      jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);
create index if not exists channel_posts_idx on channel_posts (channel_id, created_at desc);

create table if not exists channel_post_reactions (
  post_id uuid not null references channel_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji   text not null check (char_length(emoji) <= 16),
  primary key (post_id, user_id)
);

-- ═════════════════════════════════════════════════════════════════════════
-- DASHBOARD ADMIN (v2)  — aman dijalankan berulang kali
-- ═════════════════════════════════════════════════════════════════════════

-- Status moderasi akun. Dicek di requireUser (nonaktif) dan assertCanSend (batas waktu kirim).
alter table users add column if not exists disabled_permanent   boolean not null default false;
alter table users add column if not exists disabled_until       timestamptz;   -- nonaktif sementara (spam)
alter table users add column if not exists restricted_until     timestamptz;   -- batas waktu: tidak bisa kirim chat
alter table users add column if not exists restriction_reason   text;
alter table users add column if not exists restriction_category text;

-- Pool Gmail pengirim OTP. App Password disimpan TERENKRIPSI (AES-256-GCM), tidak pernah dikirim balik ke browser.
create table if not exists gmail_accounts (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,
  secret_enc      text not null,
  smtp_host       text not null default 'smtp.gmail.com',
  smtp_port       int  not null default 587 check (smtp_port in (25, 465, 587, 2525)),
  enabled         boolean not null default true,
  status          text not null default 'active' check (status in ('active','error')),
  sent_total      int not null default 0,
  sent_today      int not null default 0,
  sent_day        date,
  fail_count      int not null default 0,
  last_error      text,
  last_used_at    timestamptz,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now()
);

-- Riwayat tindakan moderasi (audit).
create table if not exists moderation_log (
  id         bigserial primary key,
  user_id    uuid references users(id) on delete set null,
  user_label text not null,
  action     text not null check (action in ('limit','disable_spam','disable_permanent','restore')),
  category   text,
  reason     text,
  until_at   timestamptz,
  admin      text not null,
  created_at timestamptz not null default now()
);
create index if not exists moderation_log_idx on moderation_log (created_at desc);

-- Laporan dari pengguna (tombol "Laporkan" di aplikasi Flutter).
create table if not exists user_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references users(id) on delete set null,
  target_id   uuid not null references users(id) on delete cascade,
  category    text not null check (category in ('spam','penipuan','pelecehan','lainnya')),
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create unique index if not exists user_reports_once on user_reports (reporter_id, target_id) where reporter_id is not null;
create index if not exists user_reports_target_idx on user_reports (target_id, created_at desc);

-- Peringatan / pengumuman yang tampil di aplikasi.
create table if not exists announcements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('update','maintenance','info','feature','warning')),
  severity     text not null default 'info' check (severity in ('info','warning','critical')),
  title        text not null,
  body         text not null default '',
  force_update boolean not null default false,
  min_version  text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz
);
create index if not exists announcements_idx on announcements (active, created_at desc);

-- Status server (satu baris).
create table if not exists server_status (
  id         int primary key default 1 check (id = 1),
  status     text not null default 'ok' check (status in ('ok','degraded','maintenance','down')),
  message    text not null default '',
  updated_at timestamptz not null default now()
);
insert into server_status (id) values (1) on conflict do nothing;

-- Hitung unduhan: aplikasi memanggil POST /api/app/install sekali saat pertama dibuka.
create table if not exists app_installs (
  device_id   text primary key check (char_length(device_id) between 8 and 64),
  platform    text not null default 'android' check (platform in ('android','ios','web','other')),
  app_version text,
  created_at  timestamptz not null default now()
);
create index if not exists app_installs_day_idx on app_installs (created_at);

-- Anti brute-force login admin.
create table if not exists admin_attempts (
  key          text primary key,
  fails        int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

-- Foto profil (opsional). Tanpa kolom ini, app tetap memakai emoji.
alter table users add column if not exists avatar_url text;

-- Izinkan tujuan unggahan 'avatar' (foto profil)
alter table media_objects drop constraint if exists media_objects_purpose_check;
alter table media_objects add constraint media_objects_purpose_check check (purpose in ('chat','status','channel','avatar'));

-- Rilis aplikasi (update wajib): APK dipecah per 4 MB oleh dashboard admin, disimpan sebagai potongan di Vercel Blob.
create table if not exists app_releases (
  id          uuid primary key default gen_random_uuid(),
  version     text not null check (version ~ '^[0-9]+(\.[0-9]+){0,3}$'),
  notes       text not null default '',
  force       boolean not null default true,
  parts       jsonb not null default '[]'::jsonb,   -- [{url, size}] urut
  size_bytes  bigint not null default 0,
  sha256      text,
  external_url text,                                -- alternatif: link unduhan di luar (GitHub Release, dll)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists app_releases_version_idx on app_releases (version);
create index if not exists app_releases_active_idx on app_releases (active, created_at desc);
