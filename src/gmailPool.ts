import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { sql } from './db';
import { config } from './config';
import { opt } from './env';
import { seal, unseal } from './secrets';

export interface SmtpTarget { user: string; pass: string; host: string; port: number }
export interface MailPayload { to: string; subject: string; text: string; html: string }

/** Batas aman harian Gmail App Password ±500; kita berhenti memakai akun di 480. */
const DAILY_SOFT_LIMIT = 480;
const BAD = ['EAUTH', 'EENVELOPE'];

export function makeTransport(t: SmtpTarget): Transporter {
  return nodemailer.createTransport({
    host: t.host,
    port: t.port,
    secure: t.port === 465, // 465 = SSL langsung, 587 = STARTTLS
    requireTLS: t.port !== 465,
    auth: { user: t.user, pass: t.pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  } as any);
}

/** Terjemahkan error nodemailer jadi kode + pesan yang ramah untuk admin. */
export function explainSmtpError(e: any): { code: string; message: string } {
  const code = String(e?.code ?? '');
  const msg = String(e?.message ?? '');
  if (code === 'EAUTH' || e?.responseCode === 535 || /invalid login|not accepted|badcredentials|application-specific/i.test(msg)) {
    return { code: 'bad_password', message: 'App Password salah, atau Verifikasi 2 Langkah belum aktif di akun itu.' };
  }
  if (code === 'ETLS' || /wrong version|ssl|tls/i.test(msg)) {
    return { code: 'tls', message: 'Gagal handshake TLS. Coba port 587 (STARTTLS) atau 465 (SSL).' };
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EDNS'].includes(code) || /timeout|getaddrinfo/i.test(msg)) {
    return { code: 'unreachable', message: 'Tidak bisa terhubung ke server SMTP. Cek host & port, atau jaringan diblokir.' };
  }
  return { code: 'unknown', message: msg.slice(0, 160) || 'Gagal memeriksa akun Gmail.' };
}

/** Login ke SMTP tanpa mengirim email. Melempar error nodemailer kalau gagal. */
export async function verifySmtp(t: SmtpTarget): Promise<void> {
  await makeTransport(t).verify();
}

export const sealPassword = seal;

/** Kirim email lewat pool: akun paling jarang dipakai hari ini dulu; gagal -> coba berikutnya; terakhir Gmail cadangan dari env. */
export async function sendViaPool(mail: MailPayload): Promise<{ via: string }> {
  const accounts = await sql`
    select id, email, secret_enc, smtp_host, smtp_port from gmail_accounts
    where enabled and status = 'active' and (sent_day is distinct from current_date or sent_today < ${DAILY_SOFT_LIMIT})
    order by (case when sent_day = current_date then sent_today else 0 end) asc, last_used_at asc nulls first
    limit 5`;

  for (const a of accounts) {
    try {
      const pass = unseal(a.secret_enc as string);
      await makeTransport({ user: a.email, pass, host: a.smtp_host, port: a.smtp_port }).sendMail({
        from: `${opt('OTP_FROM_NAME', 'R1ZCHATID')} <${a.email}>`,
        ...mail,
      });
      await sql`
        update gmail_accounts set
          sent_total = sent_total + 1,
          sent_today = case when sent_day = current_date then sent_today + 1 else 1 end,
          sent_day = current_date, last_used_at = now(), fail_count = 0, last_error = null
        where id = ${a.id}::uuid`;
      return { via: a.email as string };
    } catch (e) {
      const { message } = explainSmtpError(e);
      const hardFail = BAD.includes(String((e as any)?.code));
      await sql`
        update gmail_accounts set
          fail_count = fail_count + 1, last_error = ${message},
          status = case when ${hardFail} or fail_count + 1 >= 3 then 'error' else status end
        where id = ${a.id}::uuid`;
      console.error('[R1ZCHATID] Gmail pool gagal:', a.email, message);
    }
  }

  // Cadangan: GMAIL_USER / GMAIL_APP_PASSWORD dari environment
  if (!config.gmail || !config.appPassword) {
    throw new Error('Tidak ada Gmail pengirim yang aktif. Tambahkan lewat dashboard admin.');
  }
  const fallback = nodemailer.createTransport({ service: 'gmail', auth: { user: config.gmail, pass: config.appPassword } });
  await fallback.sendMail({ from: opt('OTP_FROM') || `R1ZCHATID <${config.gmail}>`, ...mail });
  return { via: 'env' };
}
