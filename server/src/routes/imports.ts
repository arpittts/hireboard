import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, requireAuthOrExtension, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { extractJobDescription, MAX_JD_LENGTH } from '../ai/jdExtract.js';

// Jobs saved with the Chrome extension. The extension posts the page's text (or the
// part the user selected); the server extracts the fields with the same code and
// prompt as "Paste a job description", and HireBoard opens the result as a
// prefilled form for the user to check and save. Nothing becomes an application
// without that step.

const importSchema = z.object({
  text: z
    .string()
    .trim()
    .min(80, "This page doesn't have enough text. Select the job description and try again.")
    // Whole pages can be long; the posting is almost always near the start.
    .transform((t) => t.slice(0, MAX_JD_LENGTH)),
  url: z.url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Only web pages can be saved.').nullish(),
  title: z.string().trim().max(300).nullish(),
});
const idParams = z.object({ id: z.uuid('Invalid import id.') });

export const importsRouter = Router();

importsRouter.post('/', requireAuthOrExtension, async (req, res) => {
  const userId = userIdOf(req);
  const body = importSchema.parse(req.body);
  // The account may be gone (demo accounts last a day) while the extension token lives on.
  const user = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
  if (!user.rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'This HireBoard account no longer exists. Connect the extension again.');

  const result = await extractJobDescription(body.text, { userId });
  const saved = await pool.query<{ id: string }>(
    'INSERT INTO jd_imports (user_id, page_url, page_title, text, result) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [userId, body.url ?? null, body.title ?? null, body.text, JSON.stringify(result)],
  );
  res.status(201).json({ id: saved.rows[0].id, company: result.fields.company_name, role: result.fields.role });
});

// Read by the web app (a normal login), never by the extension.
importsRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const found = await pool.query(
    `SELECT id, page_url AS url, page_title AS title, text, result, created_at FROM jd_imports
     WHERE id = $1 AND user_id = $2 AND created_at > now() - interval '1 day'`,
    [id, userIdOf(req)],
  );
  if (!found.rows[0]) throw notFound('Saved job');
  res.json(found.rows[0]);
});
