import { describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { api, createApplication, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();

const rowCounts = async (userId: string) => {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE id = $1)::int AS users,
       (SELECT COUNT(*) FROM applications WHERE user_id = $1)::int AS applications,
       (SELECT COUNT(*) FROM status_history sh JOIN applications a ON a.id = sh.application_id
         WHERE a.user_id = $1)::int AS history`,
    [userId],
  );
  return result.rows[0];
};

describe('settings', () => {
  it('starts with reminders off and can turn them on', async () => {
    const { auth } = await createUser();
    const initial = await api().get('/api/settings').set('Authorization', auth);
    expect(initial.body).toEqual({ remindersEnabled: false, isDemo: false, emailConfigured: false });
    const on = await api().put('/api/settings').set('Authorization', auth).send({ remindersEnabled: true });
    expect(on.body.remindersEnabled).toBe(true);
    const me = await api().get('/api/auth/me').set('Authorization', auth);
    expect(me.body.remindersEnabled).toBe(true);
  });

  it('rejects a non-boolean value', async () => {
    const { auth } = await createUser();
    const res = await api().put('/api/settings').set('Authorization', auth).send({ remindersEnabled: 'yes' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/export', () => {
  it("downloads the user's data and nothing secret", async () => {
    const { auth, email } = await createUser();
    await createApplication(auth, { notes: 'export me' });
    const res = await api().get('/api/export').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="?hireboard-export-\d{4}-\d{2}-\d{2}\.json"?/);
    expect(res.body.user.email).toBe(email);
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications[0].notes).toBe('export me');
    expect(res.body.statusHistory).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it("never includes another user's applications", async () => {
    const a = await createUser();
    const b = await createUser();
    await createApplication(a.auth);
    const res = await api().get('/api/export').set('Authorization', b.auth);
    expect(res.body.applications).toEqual([]);
  });
});

describe('DELETE /api/auth/account', () => {
  it('needs the current password for a real account', async () => {
    const { auth, user } = await createUser();
    const none = await api().delete('/api/auth/account').set('Authorization', auth);
    expect(none.status).toBe(403);
    const wrong = await api().delete('/api/auth/account').set('Authorization', auth).send({ password: 'wrong-one' });
    expect(wrong.status).toBe(403);
    expect((await rowCounts(user.id)).users).toBe(1);
  });

  it('removes the user and every row that belongs to them', async () => {
    const { auth, user } = await createUser();
    const other = await createUser();
    const app = await createApplication(auth);
    await api().patch(`/api/applications/${app.id}/status`).set('Authorization', auth).send({ status: 'interview' });
    await createApplication(other.auth);
    expect(await rowCounts(user.id)).toEqual({ users: 1, applications: 1, history: 2 });

    const res = await api().delete('/api/auth/account').set('Authorization', auth).send({ password: 'password123' });
    expect(res.status).toBe(200);
    expect(await rowCounts(user.id)).toEqual({ users: 0, applications: 0, history: 0 });
    expect(await rowCounts(other.user.id)).toEqual({ users: 1, applications: 1, history: 1 });
    expect((await api().get('/api/auth/me').set('Authorization', auth)).status).toBe(404);
  });

  it('deletes a demo account without a password', async () => {
    const demo = await api().post('/api/auth/demo');
    const res = await api().delete('/api/auth/account').set('Authorization', `Bearer ${demo.body.token}`);
    expect(res.status).toBe(200);
    expect(await rowCounts(demo.body.user.id)).toEqual({ users: 0, applications: 0, history: 0 });
  });
});
