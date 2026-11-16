# Dashboard Admin R1ZCHATID

Buka: `https://<domain>/admin/` — login admin ada di `database.json` (password disimpan sebagai hash scrypt).
Ganti kredensial: `node scripts/set-admin.mjs <username> <password>` lalu deploy ulang.

Setelah deploy: jalankan ulang `db/schema.sql` di Neon SQL Editor (aman diulang).
Opsional: env `ADMIN_SECRET` (rahasia token admin & enkripsi App Password Gmail).

## Endpoint untuk Flutter
| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/app/notice?version=1.0.0` | tidak | Status server + pengumuman. `mustUpdate:true` = paksa update |
| POST | `/api/app/install` `{deviceId, platform, appVersion}` | tidak | Panggil SEKALI saat pertama dibuka (dihitung sebagai unduhan) |
| POST | `/api/reports` `{userId, category, note}` | user | Lapor akun: spam/penipuan/pelecehan/lainnya |

## Error yang harus ditangani Flutter
- `403 {code:"account_disabled", permanent, until, reason}` → layar "Akun dinonaktifkan", hentikan polling.
- `403 {code:"send_limited", until, reason}` → boleh baca, tombol kirim dikunci sampai `until`.
- Event polling `/events`: `account.limited` {until, reason} dan `account.restored`.
