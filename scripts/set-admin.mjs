#!/usr/bin/env node
// Ganti username/password admin dashboard (disimpan sebagai HASH di database.json, bukan teks asli).
// Pakai:  node scripts/set-admin.mjs <username> <password>
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('Pakai: node scripts/set-admin.mjs <username> <password>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password minimal 6 karakter.');
  process.exit(1);
}

const N = 16384, r = 8, p = 1;
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N, r, p });
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'database.json');
const db = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
db.admin = { username, passwordHash: `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}` };
writeFileSync(file, JSON.stringify(db, null, 2) + '\n');
console.log(`✔ Admin "${username}" disimpan ke database.json`);
