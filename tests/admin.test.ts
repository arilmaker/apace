import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { call, UID, loginAs } from './harness';
import { fake } from './setup';
import { issueAdminToken } from '../src/adminAuth';
import { seal, unseal } from '../src/secrets';
import { explainSmtpError } from '../src/gmailPool';

beforeEach(() => fake.reset());
const adm = () => ({ headers: { authorization: `Bearer ${issueAdminToken('rilz121')}` } });

test('admin login: kredensial benar -> token', async () => {
  const r = await call('POST', '/api/admin/login', { body: { username: 'rilz121', password: 'admin233' } });
  assert.equal(r.status, 200);
  assert.ok(r.body.token.split('.').length === 3);
});
test('admin login: password salah -> 401 & dicatat', async () => {
  const r = await call('POST', '/api/admin/login', { body: { username: 'rilz121', password: 'salah' } });
  assert.equal(r.status, 401);
  assert.equal(fake.ran(/insert into admin_attempts/).length, 1);
});
test('admin login: username salah -> 401', async () => {
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 'x', password: 'admin233' } })).status, 401);
});
test('admin login: terkunci -> 429', async () => {
  fake.on(/from admin_attempts where key/, [{ locked: true, wait: 600 }]);
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 'rilz121', password: 'admin233' } })).status, 429);
});
test('route admin tanpa token -> 401', async () => {
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
});
test('token USER biasa tidak sah sebagai admin', async () => {
  assert.equal((await call('GET', '/api/admin/stats', { uid: UID })).status, 401);
});
test('stats: bentuk respons', async () => {
  fake.on(/from gmail_accounts/, [{ active: 2, total: 3, errors: 1, sent_today: 9 }]);
  fake.on(/count\(\*\) filter \(where last_seen_at/, [{ total: 50, online: 7, new_today: 4 }]);
  const r = await call('GET', '/api/admin/stats', adm());
  assert.equal(r.status, 200);
  assert.equal(r.body.gmail.active, 2);
  assert.equal(r.body.users.online, 7);
  assert.ok(Array.isArray(r.body.downloads.days));
});
test('tambah gmail: sukses -> disimpan TERENKRIPSI', async () => {
  fake.on(/insert into gmail_accounts/, (vals) => [{ id: 'g1', email: 'a@gmail.com', smtp_host: 'smtp.gmail.com', smtp_port: 587, enabled: true, status: 'active', sent_total: 0, sent_today: 0, fail_count: 0 }]);
  const r = await call('POST', '/api/admin/gmail', { ...adm(), body: { email: 'a@gmail.com', appPassword: 'abcd efgh ijkl mnop', host: 'smtp.gmail.com', port: 587 } });
  assert.equal(r.status, 201);
  const ins = fake.ran(/insert into gmail_accounts/)[0];
  assert.ok(!ins.values.includes('abcdefghijklmnop'));
  assert.equal(unseal(ins.values.find((x: any) => typeof x === 'string' && x.startsWith('v1.'))), 'abcdefghijklmnop');
  assert.ok(!JSON.stringify(r.body).includes('abcdefgh'));
});
test('tambah gmail: App Password salah -> 422 bad_password', async () => {
  fake.smtpFail = true;
  const r = await call('POST', '/api/admin/gmail', { ...adm(), body: { email: 'a@gmail.com', appPassword: 'abcdefghijklmnop', port: 587 } });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'bad_password');
  assert.equal(fake.ran(/insert into gmail_accounts/).length, 0);
});
test('tambah gmail: duplikat -> 409', async () => {
  fake.on(/from gmail_accounts where email/, [{ x: 1 }]);
  assert.equal((await call('POST', '/api/admin/gmail', { ...adm(), body: { email: 'a@gmail.com', appPassword: 'abcdefghijklmnop' } })).status, 409);
});
test('tambah gmail: port tidak diizinkan -> 400', async () => {
  assert.equal((await call('POST', '/api/admin/gmail', { ...adm(), body: { email: 'a@gmail.com', appPassword: 'abcdefghijklmnop', port: 25 } })).status, 400);
});
test('moderasi: batas waktu 6 jam', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  fake.on(/select id, email, username from users/, [{ id, email: 'x@gmail.com', username: 'spammer' }]);
  const r = await call('POST', `/api/admin/users/${id}/limit`, { ...adm(), body: { hours: 6, category: 'spam' } });
  assert.equal(r.status, 200);
  const diff = new Date(r.body.until).getTime() - Date.now();
  assert.ok(diff > 5.9 * 3600e3 && diff < 6.1 * 3600e3);
  assert.equal(fake.ran(/insert into moderation_log/).length, 1);
});
test('moderasi: nonaktifkan permanen & pulihkan', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  fake.on(/select id, email, username from users/, [{ id, email: 'x@gmail.com', username: null }]);
  assert.equal((await call('POST', `/api/admin/users/${id}/disable`, { ...adm(), body: { mode: 'permanent', category: 'penipuan' } })).body.permanent, true);
  assert.equal((await call('POST', `/api/admin/users/${id}/restore`, adm())).status, 200);
});
test('pengguna nonaktif ditolak di semua route (403 account_disabled)', async () => {
  fake.on(/from users where id = \$1::uuid/, [{ id: UID, stale: false, disabled_permanent: true, restriction_reason: 'spam' }]);
  const r = await call('GET', '/api/me', { uid: UID });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'account_disabled');
  assert.equal(r.body.permanent, true);
});
test('batas waktu: kirim pesan ditolak 403 send_limited', async () => {
  loginAs(UID);
  const CID = '33333333-3333-4333-8333-333333333333';
  fake.on(/from conversation_members cm join conversations/, [{ role: 'member', kind: 'direct', ttl_seconds: null }]);
  fake.on(/restricted_until is not null and restricted_until > now/, [{ restricted_until: new Date(Date.now() + 3600e3).toISOString(), restriction_reason: 'spam' }]);
  const r = await call('POST', `/api/conversations/${CID}/messages`, { uid: UID, body: {} });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'send_limited');
});
test('app/notice publik: status server + pengumuman', async () => {
  fake.on(/from server_status/, [{ status: 'maintenance', message: 'Perawatan 1 jam' }]);
  fake.on(/from announcements where active/, [{ id: 'n1', kind: 'update', severity: 'info', title: 'Versi 2', body: '', force_update: true, min_version: '2.0.0' }]);
  const r = await call('GET', '/api/app/notice?version=1.5.0', { uid: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.server.status, 'maintenance');
  assert.equal(r.body.mustUpdate, true);
  assert.equal((await call('GET', '/api/app/notice?version=2.0.0', { uid: null })).body.mustUpdate, false);
});
test('app/install publik', async () => {
  fake.on(/insert into app_installs/, [{ device_id: 'abcdef123456' }]);
  const r = await call('POST', '/api/app/install', { uid: null, body: { deviceId: 'abcdef123456', platform: 'android' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.counted, true);
});
test('secrets: seal/unseal & tamper', () => {
  const s = seal('rahasia');
  assert.equal(unseal(s), 'rahasia');
  assert.throws(() => unseal(s.slice(0, -2) + 'AA'));
});
test('explainSmtpError', () => {
  assert.equal(explainSmtpError({ code: 'EAUTH' }).code, 'bad_password');
  assert.equal(explainSmtpError({ code: 'ETIMEDOUT' }).code, 'unreachable');
});
