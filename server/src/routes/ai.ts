import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { callsToday } from '../ai/run.js';
import { aiConfigured } from '../ai/provider.js';
import { extractJobDescription, MAX_JD_LENGTH } from '../ai/jdExtract.js';

const extractSchema = z.object({
  text: z
    .string()
    .trim()
    .min(80, 'Paste the full job description (at least a few sentences).')
    .max(MAX_JD_LENGTH, `Job descriptions can be up to ${MAX_JD_LENGTH.toLocaleString('en-US')} characters.`),
});

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.post('/jd/extract', async (req, res) => {
  const { text } = extractSchema.parse(req.body);
  res.json(await extractJobDescription(text, { userId: userIdOf(req) }));
});

// Today's AI usage for the Settings page.
aiRouter.get('/usage', async (req, res) => {
  const userId = userIdOf(req);
  const [user, today] = await Promise.all([
    pool.query<{ ai_daily_limit: number }>('SELECT ai_daily_limit FROM users WHERE id = $1', [userId]),
    pool.query<{ cached: number; avg_latency_ms: number | null }>(
      `SELECT COUNT(*) FILTER (WHERE cached)::int AS cached,
              ROUND(AVG(latency_ms) FILTER (WHERE NOT cached AND status = 'ok'))::int AS avg_latency_ms
       FROM llm_calls
       WHERE user_id = $1
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
      [userId],
    ),
  ]);
  res.json({
    enabled: aiConfigured(),
    model: config.LLM_MODEL,
    usedToday: await callsToday(userId),
    dailyLimit: user.rows[0]?.ai_daily_limit ?? 0,
    cachedToday: today.rows[0].cached,
    avgLatencyMs: today.rows[0].avg_latency_ms,
  });
});
