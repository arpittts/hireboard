import { Router, type Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { checkDraft, KINDS, streamDraft } from '../ai/drafts.js';

// The writing assistant.
//   /api/applications/:id/drafts   GET list, POST write a new draft (streamed as server-sent events)
//   /api/drafts/:id                PUT save edits, DELETE; POST /check runs the claim check

const appParams = z.object({ id: z.uuid('Invalid application id.') });
const draftParams = z.object({ id: z.uuid('Invalid draft id.') });
const createSchema = z.object({
  kind: z.enum(KINDS),
  tone: z.enum(['formal', 'friendly']).default('formal'),
  length: z.enum(['short', 'medium']).default('medium'),
  avoid: z.array(z.string().max(500)).max(20).optional(),
});
const editSchema = z.object({ content: z.string().trim().min(1, 'The draft is empty.').max(8000) });

const DRAFT_COLUMNS = 'd.id, d.application_id, d.kind, d.tone, d.length, d.content, d.claims, d.number_flags, d.checked_at, d.model, d.prompt_version, d.created_at, d.updated_at';

async function ownedDraft(id: string, userId: string) {
  const result = await pool.query(
    `SELECT ${DRAFT_COLUMNS}, d.resume_id, a.job_description, a.notes, a.company_name, a.role
     FROM drafts d JOIN applications a ON a.id = d.application_id WHERE d.id = $1 AND a.user_id = $2`,
    [id, userId],
  );
  if (!result.rows[0]) throw notFound('Draft');
  return result.rows[0];
}

// One server-sent event: "event: <name>" and a JSON "data:" line, then a blank line.
const sendEvent = (res: Response, event: string, data: unknown) => {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const applicationDraftsRouter = Router();
applicationDraftsRouter.use(requireAuth);

applicationDraftsRouter.get('/:id/drafts', async (req, res) => {
  const { id } = appParams.parse(req.params);
  const result = await pool.query(
    `SELECT ${DRAFT_COLUMNS} FROM drafts d JOIN applications a ON a.id = d.application_id
     WHERE d.application_id = $1 AND a.user_id = $2 ORDER BY d.created_at DESC`,
    [id, userIdOf(req)],
  );
  res.json(result.rows);
});

applicationDraftsRouter.post('/:id/drafts', async (req, res) => {
  const { id } = appParams.parse(req.params);
  const userId = userIdOf(req);
  const body = createSchema.parse(req.body);

  // Everything that can fail with a normal JSON error happens before streaming starts.
  const appResult = await pool.query(
    `SELECT a.*, u.name AS user_name FROM applications a JOIN users u ON u.id = a.user_id WHERE a.id = $1 AND a.user_id = $2`,
    [id, userId],
  );
  const app = appResult.rows[0];
  if (!app) throw notFound('Application');
  const resume = await pool.query('SELECT id, parsed FROM resumes WHERE user_id = $1 AND is_active', [userId]);
  if (!resume.rows[0]) throw new AppError(400, 'NO_RESUME', 'Add your resume first: drafts may only use facts from it.');
  const checklist = await pool.query(
    'SELECT verdicts FROM requirement_checks WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
    [id],
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // ask proxies not to hold the stream back
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Stop the model if the user closes the page mid-draft.
  const stop = new AbortController();
  res.on('close', () => { if (!res.writableEnded) stop.abort(); });

  try {
    const result = await streamDraft(
      {
        kind: body.kind, tone: body.tone, length: body.length,
        candidateName: app.user_name, company: app.company_name, role: app.role,
        jobDescription: app.job_description, notes: app.notes, contactName: app.contact_name,
        requirements: app.jd_extraction?.requirements ?? [],
        checklist: checklist.rows[0]?.verdicts ?? null,
        parsed: resume.rows[0].parsed,
        avoid: body.avoid,
      },
      { userId, signal: stop.signal },
      (text) => sendEvent(res, 'text', { text }),
    );
    const saved = await pool.query(
      `INSERT INTO drafts (application_id, resume_id, kind, tone, length, content, model, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, resume.rows[0].id, body.kind, body.tone, body.length, result.text.trim(), result.model, result.promptVersion],
    );
    const { resume_id: _resumeId, ...draft } = saved.rows[0];
    sendEvent(res, 'done', { draft, firstTextMs: result.firstTextMs });
  } catch (err) {
    const error = err instanceof AppError ? { code: err.code, message: err.message } : { code: 'INTERNAL', message: 'Could not write the draft.' };
    if (!(err instanceof AppError)) console.error('Draft stream failed:', err);
    sendEvent(res, 'error', { error });
  }
  res.end();
});

export const draftsRouter = Router();
draftsRouter.use(requireAuth);

// Saving an edit clears the old check: the text has changed.
draftsRouter.put('/:id', async (req, res) => {
  const { id } = draftParams.parse(req.params);
  await ownedDraft(id, userIdOf(req));
  const { content } = editSchema.parse(req.body);
  const result = await pool.query(
    `UPDATE drafts d SET content = $2, claims = NULL, number_flags = NULL, checked_at = NULL, updated_at = now()
     WHERE id = $1 RETURNING ${DRAFT_COLUMNS}`,
    [id, content],
  );
  res.json(result.rows[0]);
});

draftsRouter.post('/:id/check', async (req, res) => {
  const { id } = draftParams.parse(req.params);
  const userId = userIdOf(req);
  const draft = await ownedDraft(id, userId);
  // The resume the draft was written from; if that was deleted, the active one.
  const original = draft.resume_id
    ? await pool.query('SELECT parsed FROM resumes WHERE id = $1 AND user_id = $2', [draft.resume_id, userId])
    : null;
  const active = await pool.query('SELECT parsed FROM resumes WHERE user_id = $1 AND is_active', [userId]);
  const parsed = original?.rows[0]?.parsed ?? active.rows[0]?.parsed;
  if (!parsed) throw new AppError(400, 'NO_RESUME', 'Add your resume first: claims are checked against it.');

  const check = await checkDraft(draft.content, parsed, [draft.job_description, draft.notes, draft.company_name, draft.role], { userId });
  const result = await pool.query(
    `UPDATE drafts d SET claims = $2, number_flags = $3, checked_at = now() WHERE id = $1 RETURNING ${DRAFT_COLUMNS}`,
    [id, JSON.stringify(check.claims), JSON.stringify(check.numberFlags)],
  );
  res.json(result.rows[0]);
});

draftsRouter.delete('/:id', async (req, res) => {
  const { id } = draftParams.parse(req.params);
  await ownedDraft(id, userIdOf(req));
  await pool.query('DELETE FROM drafts WHERE id = $1', [id]);
  res.json({ message: 'Draft deleted.' });
});
