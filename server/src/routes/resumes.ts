import { Router } from 'express';
import multer from 'multer';
import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { MAX_RESUME_LENGTH, parseResume } from '../ai/resumeParse.js';

const MAX_RESUMES = 3;
const MAX_PAGES = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// The PDF stays in memory only long enough to read its text; it is never saved.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, done) => {
    if (file.mimetype === 'application/pdf') done(null, true);
    else done(new AppError(400, 'VALIDATION', 'Upload a PDF file, or paste the text instead.'));
  },
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Give the resume a name.').max(120),
  // Pasted text; ignored when a PDF is uploaded.
  text: z.string().max(MAX_RESUME_LENGTH * 2).optional(),
});

const idParams = z.object({ id: z.uuid('Invalid resume id.') });

async function pdfToText(buffer: Buffer): Promise<string> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch {
    throw new AppError(400, 'VALIDATION', 'That file could not be read as a PDF.');
  }
  if (pdf.numPages > MAX_PAGES) {
    throw new AppError(400, 'VALIDATION', `Resumes can be up to ${MAX_PAGES} pages.`);
  }
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const toSummary = (r: { id: string; title: string; is_active: boolean; created_at: string; parsed: { sections: { bullets: unknown[] }[]; dropped: number } }) => ({
  id: r.id,
  title: r.title,
  isActive: r.is_active,
  createdAt: r.created_at,
  bulletCount: r.parsed.sections.reduce((n, s) => n + s.bullets.length, 0),
  dropped: r.parsed.dropped,
});

export const resumesRouter = Router();
resumesRouter.use(requireAuth);

resumesRouter.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT id, title, is_active, created_at, parsed FROM resumes WHERE user_id = $1 ORDER BY created_at DESC',
    [userIdOf(req)],
  );
  res.json(result.rows.map(toSummary));
});

resumesRouter.get('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const result = await pool.query('SELECT * FROM resumes WHERE id = $1 AND user_id = $2', [id, userIdOf(req)]);
  if (!result.rows[0]) throw notFound('Resume');
  const r = result.rows[0];
  res.json({ ...toSummary(r), sections: r.parsed.sections, model: r.parsed.model, promptVersion: r.parsed.promptVersion });
});

// Upload a PDF (multipart field "file") or send { title, text }. The new resume becomes the active one.
resumesRouter.post('/', upload.single('file'), async (req, res) => {
  const userId = userIdOf(req);
  const body = createSchema.parse(req.body ?? {});
  const text = (req.file ? await pdfToText(req.file.buffer) : (body.text ?? '')).replace(/\u0000/g, '').trim();
  if (text.length < 200) {
    throw new AppError(
      400,
      'VALIDATION',
      req.file
        ? 'No text could be read from this PDF (it may be a scanned image). Paste the text instead.'
        : 'Paste the whole resume (at least a few lines).',
    );
  }
  if (text.length > MAX_RESUME_LENGTH) {
    throw new AppError(400, 'VALIDATION', `Resumes can be up to ${MAX_RESUME_LENGTH.toLocaleString('en-US')} characters.`);
  }
  const count = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM resumes WHERE user_id = $1', [userId]);
  if (count.rows[0].n >= MAX_RESUMES) {
    throw new AppError(400, 'LIMIT', `You can keep up to ${MAX_RESUMES} resumes. Delete one first.`);
  }

  const parsed = await parseResume(text, userId);
  if (parsed.sections.length === 0) {
    throw new AppError(422, 'UNREADABLE', 'Could not find any resume lines in that text. Check it and try again.');
  }

  const saved = await withTransaction(async (client) => {
    await client.query('UPDATE resumes SET is_active = FALSE WHERE user_id = $1', [userId]);
    const inserted = await client.query(
      `INSERT INTO resumes (user_id, title, raw_text, parsed, is_active) VALUES ($1, $2, $3, $4, TRUE) RETURNING *`,
      [userId, body.title, text, JSON.stringify(parsed)],
    );
    return inserted.rows[0];
  });
  res.status(201).json({ ...toSummary(saved), sections: parsed.sections, model: parsed.model, promptVersion: parsed.promptVersion });
});

resumesRouter.put('/:id/activate', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const userId = userIdOf(req);
  const updated = await withTransaction(async (client) => {
    const owned = await client.query('SELECT id FROM resumes WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!owned.rows[0]) throw notFound('Resume');
    await client.query('UPDATE resumes SET is_active = FALSE WHERE user_id = $1', [userId]);
    const result = await client.query('UPDATE resumes SET is_active = TRUE WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  });
  res.json(toSummary(updated));
});

resumesRouter.delete('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const result = await pool.query('DELETE FROM resumes WHERE id = $1 AND user_id = $2 RETURNING id', [id, userIdOf(req)]);
  if (!result.rows[0]) throw notFound('Resume');
  res.json({ message: 'Resume deleted.' });
});
