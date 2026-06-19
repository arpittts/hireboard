const cron = require('node-cron');
const nodemailer = require('nodemailer');
const pool = require('../config/db');

let transporter = null;

function initEmailService() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    console.log('📧 Email service initialized');
    return true;
  }
  console.log('⚠️  Email not configured (SMTP missing)');
  return false;
}

async function sendFollowUpReminder(userEmail, userName, app) {
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'HireBoard <noreply@hireboard.app>',
      to: userEmail,
      subject: `🔔 Follow-up: ${app.company_name} - ${app.role}`,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0f0f23;color:#e2e8f0;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#6C5CE7,#a855f7);padding:32px;text-align:center"><h1 style="margin:0;color:white">📋 HireBoard</h1></div><div style="padding:32px"><p>Hi ${userName},</p><p>Time to follow up on:</p><div style="background:rgba(108,92,231,.1);border:1px solid rgba(108,92,231,.3);border-radius:12px;padding:20px;margin:20px 0"><h2 style="margin:0 0 8px;color:#a78bfa">${app.company_name}</h2><p style="margin:0;color:#e2e8f0">${app.role}</p></div><p>Good luck! 🚀</p></div></div>`,
    });
    console.log(`📧 Reminder sent to ${userEmail} for ${app.company_name}`);
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
}

function startReminderCron() {
  cron.schedule('0 9 * * *', async () => {
    console.log('⏰ Checking follow-up reminders...');
    try {
      const result = await pool.query(
        `SELECT a.*, u.email as user_email, u.name as user_name FROM applications a JOIN users u ON a.user_id = u.id WHERE a.follow_up_date = CURRENT_DATE AND a.reminder_sent = FALSE AND a.status NOT IN ('rejected','accepted','withdrawn')`
      );
      for (const app of result.rows) {
        if (await sendFollowUpReminder(app.user_email, app.user_name, app)) {
          await pool.query('UPDATE applications SET reminder_sent = TRUE WHERE id = $1', [app.id]);
        }
      }
    } catch (err) { console.error('Cron error:', err); }
  });
  console.log('⏰ Reminder cron scheduled (daily 9AM)');
}

module.exports = { initEmailService, startReminderCron };
