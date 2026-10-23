import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { emailConfigured } from '../services/reminders.js';

const settingsSchema = z.object({ remindersEnabled: z.boolean() });

// Mounted at /api, so each route checks the token itself (a router-wide check
// would also catch unknown /api paths and answer 401 instead of 404).
export const accountRouter = Router();

accountRouter.get('/settings', requireAuth, async (req, res) => {
  const result = await pool.query<{ reminders_enabled: boolean; is_demo: boolean }>(
    'SELECT reminders_enabled, is_demo FROM users WHERE id = $1',
    [userIdOf(req)],
  );
  if (!result.rows[0]) throw notFound('User');
  res.json({
    remindersEnabled: result.rows[0].reminders_enabled,
    isDemo: result.rows[0].is_demo,
    // Lets the page explain why reminders can't be sent yet.
    emailConfigured: emailConfigured(),
  });
});

accountRouter.put('/settings', requireAuth, async (req, res) => {
  const body = settingsSchema.parse(req.body);
  const result = await pool.query<{ reminders_enabled: boolean; is_demo: boolean }>(
    `UPDATE users SET reminders_enabled = $1 WHERE id = $2 AND (NOT is_demo OR $1 = FALSE)
     RETURNING reminders_enabled, is_demo`,
    [body.remindersEnabled, userIdOf(req)],
  );
  if (!result.rows[0]) {
    // Either the user is gone or it's a demo account (demo emails aren't real).
    throw new AppError(400, 'DEMO_ACCOUNT', 'Demo accounts cannot get email reminders. Create a free account to use them.');
  }
  res.json({ remindersEnabled: result.rows[0].reminders_enabled, isDemo: result.rows[0].is_demo, emailConfigured: emailConfigured() });
});

// Everything stored about the user, as a JSON download.
accountRouter.get('/export', requireAuth, async (req, res) => {
  const userId = userIdOf(req);
  const [user, applications, history, resumes, checks, banks, interviews] = await Promise.all([
    pool.query('SELECT name, email, created_at, reminders_enabled FROM users WHERE id = $1', [userId]),
    pool.query('SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at', [userId]),
    pool.query(
      `SELECT sh.* FROM status_history sh JOIN applications a ON a.id = sh.application_id
       WHERE a.user_id = $1 ORDER BY sh.changed_at`,
      [userId],
    ),
    pool.query('SELECT title, raw_text, parsed, is_active, created_at FROM resumes WHERE user_id = $1 ORDER BY created_at', [userId]),
    pool.query(
      `SELECT rc.application_id, rc.verdicts, rc.model, rc.prompt_version, rc.created_at FROM requirement_checks rc
       JOIN applications a ON a.id = rc.application_id WHERE a.user_id = $1 ORDER BY rc.created_at`,
      [userId],
    ),
    pool.query(
      `SELECT qb.application_id, qb.questions, qb.created_at FROM question_banks qb
       JOIN applications a ON a.id = qb.application_id WHERE a.user_id = $1 ORDER BY qb.created_at`,
      [userId],
    ),
    pool.query(
      `SELECT s.id, s.application_id, s.status, s.questions, s.created_at, s.completed_at,
              COALESCE((SELECT json_agg(json_build_object('speaker', t.speaker, 'kind', t.kind, 'content', t.content) ORDER BY t.id)
                        FROM interview_turns t WHERE t.session_id = s.id), '[]') AS turns
       FROM interview_sessions s WHERE s.user_id = $1 ORDER BY s.created_at`,
      [userId],
    ),
  ]);
  if (!user.rows[0]) throw notFound('User');
  const date = new Date().toISOString().slice(0, 10);
  res.attachment(`hireboard-export-${date}.json`);
  res.json({
    exportedAt: new Date().toISOString(),
    user: user.rows[0],
    applications: applications.rows,
    statusHistory: history.rows,
    resumes: resumes.rows,
    requirementChecks: checks.rows,
    questionBanks: banks.rows,
    interviews: interviews.rows,
  });
});
