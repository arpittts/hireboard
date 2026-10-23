import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

// Follow-up reminder emails. A GitHub Actions schedule calls
// POST /api/internal/reminders once a day (see .github/workflows/cron.yml),
// because the free server sleeps and can't keep a timer of its own.

const MAX_PER_USER = 5;
// If a daily run is missed (server down, GitHub delay), still remind for recent dates.
const CATCH_UP_DAYS = 3;

export interface DueReminder {
  id: string;
  company_name: string;
  role: string;
  follow_up_date: string;
  user_email: string;
  user_name: string;
}

export type SendEmail = (to: string, subject: string, html: string) => Promise<void>;

let transporter: Transporter | null = null;

// No single email may hang the daily job (Render's free plan silently drops SMTP).
const SEND_TIMEOUT_MS = 15_000;

const useBrevo = () => Boolean(config.BREVO_API_KEY);
const useSmtp = () => Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);
export const emailConfigured = () => useBrevo() || useSmtp();

// "HireBoard <you@gmail.com>" → { name: 'HireBoard', email: 'you@gmail.com' }
export function parseFrom(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || undefined, email: match[2] } : { email: from.trim() };
}

// Brevo's transactional email API, over HTTPS (port 443).
function brevoSender(): SendEmail {
  return async (to, subject, html) => {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: parseFrom(config.EMAIL_FROM), to: [{ email: to }], subject, htmlContent: html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brevo answered ${res.status}: ${body.slice(0, 300)}`);
    }
  };
}

function smtpSender(): SendEmail {
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    // Give up quickly instead of waiting minutes when the port is blocked.
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  const mailer = transporter;
  return async (to, subject, html) => {
    await mailer.sendMail({ from: config.EMAIL_FROM, to, subject, html });
  };
}

// The configured sender (Brevo first), or null when email isn't set up.
export function emailSender(): SendEmail | null {
  if (useBrevo()) return brevoSender();
  if (useSmtp()) return smtpSender();
  return null;
}

// Names come from user input; escape them before putting them in HTML.
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function reminderEmail(app: DueReminder) {
  const subject = `🔔 Follow-up: ${app.company_name} - ${app.role}`;
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f0f23;color:#e2e8f0;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#6C5CE7,#a855f7);padding:32px;text-align:center"><h1 style="margin:0;color:white">📋 HireBoard</h1></div><div style="padding:32px"><p>Hi ${escapeHtml(app.user_name)},</p><p>Time to follow up on:</p><div style="background:rgba(108,92,231,.1);border:1px solid rgba(108,92,231,.3);border-radius:12px;padding:20px;margin:20px 0"><h2 style="margin:0 0 8px;color:#a78bfa">${escapeHtml(app.company_name)}</h2><p style="margin:0;color:#e2e8f0">${escapeHtml(app.role)}</p></div><p>Good luck! 🚀</p><p style="font-size:12px;color:#94a3b8">You get this because reminders are on in HireBoard Settings.</p></div></div>`;
  return { subject, html };
}

// Applications whose follow-up date has come, for users who turned reminders on.
// Never demo users, never closed applications, at most MAX_PER_USER per user.
export async function findDueReminders(): Promise<DueReminder[]> {
  const result = await pool.query<DueReminder>(
    `SELECT id, company_name, role, follow_up_date, user_email, user_name FROM (
       SELECT a.id, a.company_name, a.role, a.follow_up_date, u.email AS user_email, u.name AS user_name,
              ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY a.follow_up_date, a.id) AS n
       FROM applications a JOIN users u ON u.id = a.user_id
       WHERE u.reminders_enabled AND NOT u.is_demo
         AND a.reminder_sent = FALSE
         AND a.follow_up_date BETWEEN CURRENT_DATE - $1::int AND CURRENT_DATE
         AND a.status NOT IN ('rejected', 'accepted', 'withdrawn')
     ) due
     WHERE n <= $2`,
    [CATCH_UP_DAYS, MAX_PER_USER],
  );
  return result.rows;
}

// Sends each due reminder and marks it sent, so it never goes out twice.
export async function sendDueReminders(send: SendEmail) {
  const due = await findDueReminders();
  let sent = 0;
  let failed = 0;
  for (const app of due) {
    const { subject, html } = reminderEmail(app);
    try {
      await send(app.user_email, subject, html);
      await pool.query('UPDATE applications SET reminder_sent = TRUE WHERE id = $1', [app.id]);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`Reminder for application ${app.id} failed:`, (err as Error).message);
    }
  }
  return { due: due.length, sent, failed };
}
