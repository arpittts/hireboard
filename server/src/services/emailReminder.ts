import cron from 'node-cron';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

// Daily follow-up reminders. On Render's free plan the server sleeps, so this
// rarely fires; Phase 1 moves it to a GitHub Actions schedule.

let transporter: Transporter | null = null;

interface ReminderRow {
  id: string;
  company_name: string;
  role: string;
  user_email: string;
  user_name: string;
}

// Names come from user input; escape them before putting them in HTML.
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function initEmailService(): boolean {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASS) {
    console.log('⚠️  Email not configured (SMTP missing)');
    return false;
  }
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  console.log('📧 Email service initialized');
  return true;
}

async function sendFollowUpReminder(app: ReminderRow): Promise<boolean> {
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: config.EMAIL_FROM,
      to: app.user_email,
      subject: `🔔 Follow-up: ${app.company_name} - ${app.role}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f0f23;color:#e2e8f0;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#6C5CE7,#a855f7);padding:32px;text-align:center"><h1 style="margin:0;color:white">📋 HireBoard</h1></div><div style="padding:32px"><p>Hi ${escapeHtml(app.user_name)},</p><p>Time to follow up on:</p><div style="background:rgba(108,92,231,.1);border:1px solid rgba(108,92,231,.3);border-radius:12px;padding:20px;margin:20px 0"><h2 style="margin:0 0 8px;color:#a78bfa">${escapeHtml(app.company_name)}</h2><p style="margin:0;color:#e2e8f0">${escapeHtml(app.role)}</p></div><p>Good luck! 🚀</p></div></div>`,
    });
    console.log(`📧 Reminder sent for ${app.company_name}`);
    return true;
  } catch (err) {
    console.error('Email error:', (err as Error).message);
    return false;
  }
}

export function startReminderCron(): void {
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Checking follow-up reminders...');
    try {
      const result = await pool.query<ReminderRow>(
        `SELECT a.id, a.company_name, a.role, u.email AS user_email, u.name AS user_name
         FROM applications a JOIN users u ON a.user_id = u.id
         WHERE a.follow_up_date = CURRENT_DATE AND a.reminder_sent = FALSE
           AND a.status NOT IN ('rejected', 'accepted', 'withdrawn')`,
      );
      for (const app of result.rows) {
        if (await sendFollowUpReminder(app)) {
          await pool.query('UPDATE applications SET reminder_sent = TRUE WHERE id = $1', [app.id]);
        }
      }
    } catch (err) {
      console.error('Cron error:', err);
    }
  });
  console.log('⏰ Reminder cron scheduled (daily 9AM)');
}
