import { describe, expect, it } from 'vitest';
import { api, createApplication, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('applications CRUD', () => {
  it('creates an application with defaults and a first history entry', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth);
    expect(app).toMatchObject({ type: 'job', status: 'applied', priority: 'medium', deadline: null });
    expect(app.application_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const detail = await api().get(`/api/applications/${app.id}`).set('Authorization', auth);
    expect(detail.status).toBe(200);
    expect(detail.body.statusHistory).toHaveLength(1);
    expect(detail.body.statusHistory[0]).toMatchObject({ from_status: null, to_status: 'applied' });
  });

  it('keeps dates exactly as sent (no timezone shift)', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth, { application_date: '2026-10-23', follow_up_date: '2026-10-30' });
    expect(app.application_date).toBe('2026-10-23');
    expect(app.follow_up_date).toBe('2026-10-30');
  });

  it('rejects missing required fields and unknown enum values', async () => {
    const { auth } = await createUser();
    const missing = await api().post('/api/applications').set('Authorization', auth).send({ role: 'SWE' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.company_name).toBeDefined();
    const badStatus = await api()
      .post('/api/applications')
      .set('Authorization', auth)
      .send({ company_name: 'Acme', role: 'SWE', status: 'hired' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.fields.status).toBeDefined();
  });

  it('updates only the fields sent, and clears a date sent as an empty string', async () => {
    // Regression: the edit form sends '' for empty dates, which used to fail with a 500.
    const { auth } = await createUser();
    const app = await createApplication(auth, { deadline: '2026-11-01', notes: 'keep me' });
    const res = await api()
      .put(`/api/applications/${app.id}`)
      .set('Authorization', auth)
      .send({ role: 'Backend Intern', deadline: '', follow_up_date: '' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'Backend Intern', deadline: null, notes: 'keep me', company_name: 'Acme' });
  });

  it('records a status change made through the edit form', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth);
    await api().put(`/api/applications/${app.id}`).set('Authorization', auth).send({ status: 'interview' });
    const history = await api().get(`/api/applications/${app.id}/history`).set('Authorization', auth);
    expect(history.body.map((h: { to_status: string }) => h.to_status)).toEqual(['interview', 'applied']);
  });

  it('changes status from the Kanban board and skips no-op moves', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth);
    const moved = await api()
      .patch(`/api/applications/${app.id}/status`)
      .set('Authorization', auth)
      .send({ status: 'offer', note: 'Got the call' });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe('offer');
    const same = await api().patch(`/api/applications/${app.id}/status`).set('Authorization', auth).send({ status: 'offer' });
    expect(same.body.message).toBe('Status unchanged.');
    const history = await api().get(`/api/applications/${app.id}/history`).set('Authorization', auth);
    expect(history.body).toHaveLength(2);
    expect(history.body[0]).toMatchObject({ from_status: 'applied', to_status: 'offer', note: 'Got the call' });
  });

  it('deletes an application', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth);
    expect((await api().delete(`/api/applications/${app.id}`).set('Authorization', auth)).status).toBe(200);
    expect((await api().get(`/api/applications/${app.id}`).set('Authorization', auth)).status).toBe(404);
  });

  it('filters, searches and sorts the list', async () => {
    const { auth } = await createUser();
    await createApplication(auth, { company_name: 'Zeta', role: 'Data Intern', status: 'interview', type: 'internship' });
    await createApplication(auth, { company_name: 'Alpha', role: 'ML Engineer', status: 'applied' });
    await createApplication(auth, { company_name: 'Beta', role: 'Data Analyst', status: 'interview' });

    const list = (query: Record<string, string>) =>
      api().get('/api/applications').query(query).set('Authorization', auth);

    expect((await list({ status: 'interview' })).body).toHaveLength(2);
    expect((await list({ type: 'internship' })).body).toHaveLength(1);
    expect((await list({ search: 'data' })).body).toHaveLength(2);
    const sorted = await list({ sort: 'company_name', order: 'asc' });
    expect(sorted.body.map((a: { company_name: string }) => a.company_name)).toEqual(['Alpha', 'Beta', 'Zeta']);
    expect((await list({ status: '' })).body).toHaveLength(3);
    expect((await list({ sort: 'password_hash' })).status).toBe(400);
  });

  it('returns 400 for a malformed id and for malformed JSON', async () => {
    const { auth } = await createUser();
    const badId = await api().get('/api/applications/not-a-uuid').set('Authorization', auth);
    expect(badId.status).toBe(400);
    const badJson = await api()
      .post('/api/applications')
      .set('Authorization', auth)
      .set('Content-Type', 'application/json')
      .send('{"company_name": ');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('BAD_JSON');
  });

  it('requires a token', async () => {
    expect((await api().get('/api/applications')).status).toBe(401);
  });
});

describe('user isolation', () => {
  it("never lets user B see or change user A's applications", async () => {
    const a = await createUser('A');
    const b = await createUser('B');
    const app = await createApplication(a.auth);
    const asB = (req: ReturnType<ReturnType<typeof api>['get']>) => req.set('Authorization', b.auth);

    expect((await asB(api().get('/api/applications'))).body).toEqual([]);
    expect((await asB(api().get(`/api/applications/${app.id}`))).status).toBe(404);
    expect((await asB(api().get(`/api/applications/${app.id}/history`))).status).toBe(404);
    expect((await api().put(`/api/applications/${app.id}`).set('Authorization', b.auth).send({ role: 'x' })).status).toBe(404);
    expect(
      (await api().patch(`/api/applications/${app.id}/status`).set('Authorization', b.auth).send({ status: 'offer' })).status,
    ).toBe(404);
    expect((await api().delete(`/api/applications/${app.id}`).set('Authorization', b.auth)).status).toBe(404);
    expect((await asB(api().get('/api/dashboard/stats'))).body.total).toBe(0);

    // A's application is untouched.
    const still = await api().get(`/api/applications/${app.id}`).set('Authorization', a.auth);
    expect(still.body).toMatchObject({ role: 'Software Engineer Intern', status: 'applied' });
    expect(still.body.statusHistory).toHaveLength(1);
  });

  it('ignores a user_id sent in the body', async () => {
    const a = await createUser('A');
    const b = await createUser('B');
    const app = await createApplication(a.auth, { user_id: b.user.id });
    expect(app.user_id).toBe(a.user.id);
  });
});
