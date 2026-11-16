/**
 * Gmail cadangan (fallback) pengirim OTP — dipakai kalau pool Gmail di dashboard admin kosong.
 * Isi lewat environment variable di Vercel, JANGAN ditulis di kode / di-commit.
 */
export const config = {
  gmail: process.env.GMAIL_USER ?? '',
  appPassword: process.env.GMAIL_APP_PASSWORD ?? '',
};
