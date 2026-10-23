import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { DEMO_APPLICATION_COUNT } from '../src/services/demoSeed.js';
import { api, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('POST /api/auth/demo', () => {
  it('creates a demo account full of synthetic data', async () => {
    const res = await api().post('/api/auth/demo');
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Demo User', isDemo: true, remindersEnabled: false });
    const auth = `Bearer ${res.body.token}`;

    const apps = await api().get('/api/applications').set('Authorization', auth);
    expect(apps.body).toHaveLength(DEMO_APPLICATION_COUNT);
    expect(DEMO_APPLICATION_COUNT).toBe(12);
    const statuses = new Set(apps.body.map((a: { status: string }) => a.status));
    expect([...statuses].sort()).toEqual(['accepted', 'applied', 'interview', 'offer', 'rejected', 'wishlist', 'withdrawn']);

    const stats = await api().get('/api/dashboard/stats').set('Authorization', auth);
    expect(stats.body.total).toBe(12);
    expect(stats.body.upcomingFollowUps.length).toBeGreaterThan(0);
    expect(stats.body.monthlyApplications.length).toBeGreaterThan(1);

    // History follows each application's path, e.g. applied → interview → offer.
    const bluepeak = apps.body.find((a: { company_name: string }) => a.company_name === 'Bluepeak AI');
    const history = await api().get(`/api/applications/${bluepeak.id}/history`).set('Authorization', auth);
    expect(history.body.map((h: { to_status: string }) => h.to_status)).toEqual(['offer', 'interview', 'applied']);
  });

  it('gives every visitor a separate account', async () => {
    const a = await api().post('/api/auth/demo');
    const b = await api().post('/api/auth/demo');
    expect(a.body.user.id).not.toBe(b.body.user.id);
    const appsA = await api().get('/api/applications').set('Authorization', `Bearer ${a.body.token}`);
    await api().delete(`/api/applications/${appsA.body[0].id}`).set('Authorization', `Bearer ${a.body.token}`);
    const appsB = await api().get('/api/applications').set('Authorization', `Bearer ${b.body.token}`);
    expect(appsB.body).toHaveLength(12);
  });

  it('cannot be logged into with a password', async () => {
    const demo = await api().post('/api/auth/demo');
    const login = await api().post('/api/auth/login').send({ email: demo.body.user.email, password: 'anything' });
    expect(login.status).toBe(401);
  });

  it('is rate limited per IP', async () => {
    const limited = createApp({ demoRateLimit: 2 });
    expect((await request(limited).post('/api/auth/demo')).status).toBe(201);
    expect((await request(limited).post('/api/auth/demo')).status).toBe(201);
    expect((await request(limited).post('/api/auth/demo')).status).toBe(429);
  });

  it('cannot turn on email reminders', async () => {
    const demo = await api().post('/api/auth/demo');
    const res = await api()
      .put('/api/settings')
      .set('Authorization', `Bearer ${demo.body.token}`)
      .send({ remindersEnabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DEMO_ACCOUNT');
    const user = await pool.query('SELECT reminders_enabled FROM users WHERE id = $1', [demo.body.user.id]);
    expect(user.rows[0].reminders_enabled).toBe(false);
  });
});
