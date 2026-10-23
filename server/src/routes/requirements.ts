import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { extractJobDescription } from '../ai/jdExtract.js';
import { checkRequirements, type Requirement } from '../ai/requirementsCheck.js';

// GET/POST /api/applications/:id/requirements: the requirements checklist.

const idParams = z.object({ id: z.uuid('Invalid application id.') });

export const requirementsRouter = Router();
requirementsRouter.use(requireAuth);

requirementsRouter.get('/:id/requirements', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const owned = await pool.query('SELECT id FROM applications WHERE id = $1 AND user_id = $2', [id, userIdOf(req)]);
  if (!owned.rows[0]) throw notFound('Application');
  const latest = await pool.query(
    `SELECT rc.id, rc.verdicts, rc.model, rc.prompt_version, rc.created_at, r.title AS resume_title
     FROM requirement_checks rc LEFT JOIN resumes r ON r.id = rc.resume_id
     WHERE rc.application_id = $1 ORDER BY rc.created_at DESC LIMIT 1`,
    [id],
  );
  res.json(latest.rows[0] ?? null);
});

requirementsRouter.post('/:id/requirements', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const userId = userIdOf(req);
  const appResult = await pool.query(
    'SELECT id, job_description, jd_extraction FROM applications WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  const app = appResult.rows[0];
  if (!app) throw notFound('Application');

  const resume = await pool.query('SELECT id, title, parsed FROM resumes WHERE user_id = $1 AND is_active', [userId]);
  if (!resume.rows[0]) throw new AppError(400, 'NO_RESUME', 'Add your resume first (Resume page).');

  // Requirements come from the saved extraction; if the job description was
  // typed in by hand, read it now and keep the result.
  let requirements: Requirement[] = app.jd_extraction?.requirements ?? [];
  if (requirements.length === 0 && app.job_description) {
    const jd = await extractJobDescription(app.job_description, { userId });
    requirements = jd.extraction.requirements;
    await pool.query('UPDATE applications SET jd_extraction = $1 WHERE id = $2', [
      JSON.stringify({ requirements, model: jd.model, promptVersion: jd.promptVersion, warnings: jd.warnings }),
      id,
    ]);
  }
  if (requirements.length === 0) {
    throw new AppError(400, 'NO_JOB_DESCRIPTION', 'Add the job description to this application first (Edit → Job description).');
  }

  const result = await checkRequirements(requirements, resume.rows[0].parsed, { userId });
  const saved = await pool.query(
    `INSERT INTO requirement_checks (application_id, resume_id, verdicts, model, prompt_version)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, verdicts, model, prompt_version, created_at`,
    [id, resume.rows[0].id, JSON.stringify(result.verdicts), result.model, result.promptVersion],
  );
  res.status(201).json({ ...saved.rows[0], resume_title: resume.rows[0].title });
});
