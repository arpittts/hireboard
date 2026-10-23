import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { sendDueReminders, smtpSender } from '../services/reminders.js';

// Routes for the daily GitHub Actions job. They need the X-Cron-Secret header.

const requireCronSecret: RequestHandler = (req, _res, next) => {
  if (!config.CRON_SECRET) throw new AppError(503, 'DISABLED', 'Scheduled jobs are not configured.');
  const given = Buffer.from(req.get('X-Cron-Secret') ?? '');
  const expected = Buffer.from(config.CRON_SECRET);
  // timingSafeEqual stops an attacker from guessing the secret one character at a time.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing or wrong cron secret.');
  }
  next();
};

export const internalRouter = Router();
internalRouter.use(requireCronSecret);

internalRouter.post('/reminders', async (_req, res) => {
  const send = smtpSender();
  if (!send) {
    res.json({ skipped: true, reason: 'SMTP is not configured.' });
    return;
  }
  const result = await sendDueReminders(send);
  console.log(`⏰ Reminders: ${result.sent} sent, ${result.failed} failed`);
  res.json(result);
});

internalRouter.post('/cleanup', async (_req, res) => {
  const deleted = await pool.query(
    `DELETE FROM users WHERE is_demo AND created_at < NOW() - INTERVAL '24 hours' RETURNING id`,
  );
  console.log(`🧹 Deleted ${deleted.rowCount} expired demo accounts`);
  res.json({ deletedDemoUsers: deleted.rowCount });
});
