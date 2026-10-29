import type pg from 'pg';
import { notFound } from '../middleware/errors.js';
import { APP_COLUMNS } from '../routes/applications.js';

// Changes to applications that more than one place makes (the routes and the
// copilot's confirmed actions). Each runs inside the caller's transaction.

export async function changeStatus(client: pg.PoolClient, userId: string, id: string, status: string, note?: string | null) {
  const existing = await client.query<{ status: string }>(
    'SELECT status FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE',
    [id, userId],
  );
  if (!existing.rows[0]) throw notFound('Application');
  const oldStatus = existing.rows[0].status;
  if (oldStatus === status) return null;

  const updated = await client.query(`UPDATE applications SET status = $1 WHERE id = $2 RETURNING ${APP_COLUMNS}`, [status, id]);
  await client.query(
    'INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1, $2, $3, $4)',
    [id, oldStatus, status, note || `Status changed from ${oldStatus} to ${status}`],
  );
  return updated.rows[0];
}

export async function setFollowUp(client: pg.PoolClient, userId: string, id: string, date: string) {
  // A new follow-up date deserves a new reminder.
  const updated = await client.query(
    `UPDATE applications SET follow_up_date = $3, reminder_sent = FALSE WHERE id = $1 AND user_id = $2 RETURNING ${APP_COLUMNS}`,
    [id, userId, date],
  );
  if (!updated.rows[0]) throw notFound('Application');
  return updated.rows[0];
}

export async function insertApplication(client: pg.PoolClient, userId: string, fields: Record<string, unknown>) {
  const columns = ['user_id', ...Object.keys(fields)];
  const values = [userId, ...Object.values(fields)];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const created = await client.query(
    `INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders}) RETURNING ${APP_COLUMNS}`,
    values,
  );
  await client.query(
    'INSERT INTO status_history (application_id, from_status, to_status, note) VALUES ($1, NULL, $2, $3)',
    [created.rows[0].id, created.rows[0].status, 'Application created'],
  );
  return created.rows[0];
}
