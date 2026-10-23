import { describe, expect, it } from 'vitest';
import { api, createApplication, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('GET /api/dashboard/stats', () => {
  it('returns zeros for a new user', async () => {
    const { auth } = await createUser();
    const res = await api().get('/api/dashboard/stats').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, responseRate: 0, rejectionRate: 0, statusBreakdown: [] });
  });

  it('counts statuses and rates', async () => {
    const { auth } = await createUser();
    const today = new Date().toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await createApplication(auth, { status: 'applied', follow_up_date: nextWeek, application_date: today });
    await createApplication(auth, { status: 'interview', application_date: today });
    await createApplication(auth, { status: 'offer', application_date: today });
    await createApplication(auth, { status: 'rejected', application_date: today });

    const res = await api().get('/api/dashboard/stats').set('Authorization', auth);
    expect(res.body.total).toBe(4);
    expect(res.body.responseRate).toBe(50); // interview + offer out of 4
    expect(res.body.rejectionRate).toBe(25);
    expect(res.body.statusBreakdown).toContainEqual({ status: 'interview', count: 1 });
    expect(res.body.monthlyApplications).toEqual([{ month: today.slice(0, 7), count: 4 }]);
    expect(res.body.upcomingFollowUps).toHaveLength(1);
    expect(res.body.recentActivity).toHaveLength(4);
  });
});
