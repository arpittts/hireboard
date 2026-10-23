import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { notFound } from '../middleware/errors.js';

export const STATUSES = ['wishlist', 'applied', 'interview', 'offer', 'rejected', 'accepted', 'withdrawn'] as const;
const TYPES = ['job', 'internship', 'freelance', 'contract'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const SORTS = ['created_at', 'updated_at', 'application_date', 'company_name', 'deadline', 'priority'] as const;

// The form sends '' for an empty field; store that as NULL.
const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);
const optionalDate = z
  .union([z.iso.date('Dates must be in the format YYYY-MM-DD.'), z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required.`).max(255);

// Fields shared by create and update.
const fields = {
  company_name: requiredText('Company name'),
  role: requiredText('Role'),
  type: z.enum(TYPES),
  status: z.enum(STATUSES),
  priority: z.enum(PRIORITIES),
  application_date: z.iso.date('Application date must be a date (YYYY-MM-DD).'),
  deadline: optionalDate,
  follow_up_date: optionalDate,
  url: optionalText(500),
  location: optionalText(255),
  salary: optionalText(100),
  notes: optionalText(10_000),
  contact_name: optionalText(255),
  contact_email: optionalText(255),
  contact_phone: optionalText(50),
  contact_linkedin: optionalText(500),
};

const createSchema = z.object({
  ...fields,
  type: fields.type.default('job'),
  status: fields.status.default('applied'),
  priority: fields.priority.default('medium'),
  application_date: z
    .union([fields.application_date, z.literal('')])
    .optional()
    .transform((v) => v || new Date().toISOString().slice(0, 10)),
});

// Update: every field optional. A field left out keeps its old value; '' clears an optional field.
const updateSchema = z
  .object(fields)
  .partial()
  .extend({ status_note: z.string().trim().max(1000).optional() });

const statusSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(1000).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional().or(z.literal('').transform(() => undefined)),
  type: z.enum(TYPES).optional().or(z.literal('').transform(() => undefined)),
  priority: z.enum(PRIORITIES).optional().or(z.literal('').transform(() => undefined)),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(SORTS).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const idParams = z.object({ id: z.uuid('Invalid application id.') });

// Columns a client may write. Anything else in the body is ignored.
const WRITABLE = [
  'company_name', 'role', 'type', 'status', 'application_date', 'deadline', 'url', 'location', 'salary',
  'notes', 'contact_name', 'contact_email', 'contact_phone', 'contact_linkedin', 'follow_up_date', 'priority',
] as const;

export const applicationsRouter = Router();
applicationsRouter.use(requireAuth);

applicationsRouter.get('/', async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  const values: unknown[] = [userIdOf(req)];
  let sql = 'SELECT * FROM applications WHERE user_id = $1';
  if (q.status) { values.push(q.status); sql += ` AND status = $${values.length}`; }
  if (q.type) { values.push(q.type); sql += ` AND type = $${values.length}`; }
  if (q.priority) { values.push(q.priority); sql += ` AND priority = $${values.length}`; }
  if (q.search) {
    values.push(`%${q.search}%`);
    sql += ` AND (company_name ILIKE $${values.length} OR role ILIKE $${values.length})`;
  }
  // Safe to put in the SQL: both come from fixed lists checked by the schema.
  sql += ` ORDER BY ${q.sort} ${q.order.toUpperCase()}`;
  const result = await pool.query(sql, values);
  res.json(result.rows);
});

applicationsRouter.get('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const result = await pool.query('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [id, userIdOf(req)]);
  if (!result.rows[0]) throw notFound('Application');
  const history = await pool.query(
    'SELECT * FROM status_history WHERE application_id = $1 ORDER BY changed_at DESC',
    [id],
  );
  res.json({ ...result.rows[0], statusHistory: history.rows });
});

applicationsRouter.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const app = await withTransaction(async (client) => {
    const columns = ['user_id', ...WRITABLE];
    const values = [userIdOf(req), ...WRITABLE.map((col) => body[col] ?? null)];
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const created = await client.query(
      `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values,
    );
    await client.query(
      'INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1, NULL, $2, $3)',
      [created.rows[0].id, created.rows[0].status, 'Application created'],
    );
    return created.rows[0];
  });
  res.status(201).json(app);
});

applicationsRouter.put('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = updateSchema.parse(req.body);
  const userId = userIdOf(req);
  const app = await withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT status FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    if (!existing.rows[0]) throw notFound('Application');
    const oldStatus: string = existing.rows[0].status;

    // Only the fields sent in the body are changed.
    const sent = WRITABLE.filter((col) => body[col] !== undefined);
    const updated =
      sent.length > 0
        ? await client.query(
            `UPDATE applications SET ${sent.map((col, i) => `${col} = $${i + 2}`).join(', ')}
             WHERE id = $1 RETURNING *`,
            [id, ...sent.map((col) => body[col])],
          )
        : await client.query('SELECT * FROM applications WHERE id = $1', [id]);

    if (body.status && body.status !== oldStatus) {
      await client.query(
        'INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)',
        [id, oldStatus, body.status, body.status_note || `Status changed from ${oldStatus} to ${body.status}`],
      );
    }
    return updated.rows[0];
  });
  res.json(app);
});

applicationsRouter.delete('/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const result = await pool.query('DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id', [
    id,
    userIdOf(req),
  ]);
  if (!result.rows[0]) throw notFound('Application');
  res.json({ message: 'Application deleted successfully.' });
});

// Kanban drag and drop.
applicationsRouter.patch('/:id/status', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { status, note } = statusSchema.parse(req.body);
  const userId = userIdOf(req);
  const result = await withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT status FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    if (!existing.rows[0]) throw notFound('Application');
    const oldStatus: string = existing.rows[0].status;
    if (oldStatus === status) return { message: 'Status unchanged.' };

    const updated = await client.query('UPDATE applications SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    await client.query(
      'INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)',
      [id, oldStatus, status, note || `Status changed from ${oldStatus} to ${status}`],
    );
    return updated.rows[0];
  });
  res.json(result);
});

applicationsRouter.get('/:id/history', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const owned = await pool.query('SELECT id FROM applications WHERE id = $1 AND user_id = $2', [id, userIdOf(req)]);
  if (!owned.rows[0]) throw notFound('Application');
  const history = await pool.query(
    'SELECT * FROM status_history WHERE application_id = $1 ORDER BY changed_at DESC',
    [id],
  );
  res.json(history.rows);
});
