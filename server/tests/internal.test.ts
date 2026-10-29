import { describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { sendDueReminders, type SendEmail } from '../src/services/reminders.js';
import { api, createApplication, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();

const SECRET = 'test-cron-secret-0123456789';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// A fake email sender that remembers what it was asked to send.
function fakeSender() {
  const sent: { to: string; subject: string; html: string }[] = [];
  const send: SendEmail = async (to, subject, html) => {
    sent.push({ to, subject, html });
  };
  return { sent, send };
}

async function userWithReminders(on = true) {
  const user = await createUser();
  await api().put('/api/settings').set('Authorization', user.auth).send({ remindersEnabled: on });
  return user;
}

describe('internal routes', () => {
  it('refuse requests without the right secret', async () => {
    expect((await api().post('/api/internal/cleanup')).status).toBe(401);
    expect((await api().post('/api/internal/cleanup').set('X-Cron-Secret', 'wrong')).status).toBe(401);
    expect((await api().post('/api/internal/cleanup').set('X-Cron-Secret', SECRET)).status).toBe(200);
  });

  it('skip reminders when SMTP is not configured', async () => {
    const res = await api().post('/api/internal/reminders').set('X-Cron-Secret', SECRET);
    expect(res.body).toMatchObject({ skipped: true });
  });

  it('delete demo accounts older than 24 hours, and nothing else', async () => {
    const oldDemo = await api().post('/api/auth/demo');
    const newDemo = await api().post('/api/auth/demo');
    const real = await createUser();
    await pool.query(`UPDATE users SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1 OR id = $2`, [
      oldDemo.body.user.id,
      real.user.id,
    ]);

    const res = await api().post('/api/internal/cleanup').set('X-Cron-Secret', SECRET);
    expect(res.body).toEqual({ deletedDemoUsers: 1, deletedImports: 0 });
    const left = await pool.query('SELECT id FROM users ORDER BY created_at');
    expect(left.rows.map((r) => r.id).sort()).toEqual([newDemo.body.user.id, real.user.id].sort());
    const orphans = await pool.query('SELECT COUNT(*)::int AS n FROM applications WHERE user_id = $1', [oldDemo.body.user.id]);
    expect(orphans.rows[0].n).toBe(0);
  });
});

describe('sendDueReminders', () => {
  it('emails opted-in users about follow-ups due today, once', async () => {
    const { auth, email } = await userWithReminders();
    await createApplication(auth, { company_name: 'Due Today <Co>', follow_up_date: day(0) });
    await createApplication(auth, { company_name: 'Next Week', follow_up_date: day(7) });

    const first = fakeSender();
    expect(await sendDueReminders(first.send)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(first.sent[0].to).toBe(email);
    expect(first.sent[0].subject).toContain('Due Today <Co>');
    expect(first.sent[0].html).toContain('Due Today &lt;Co&gt;'); // escaped in HTML

    const second = fakeSender();
    expect((await sendDueReminders(second.send)).sent).toBe(0);
  });

  it('skips users who have not opted in, demo users and closed applications', async () => {
    const off = await userWithReminders(false);
    await createApplication(off.auth, { follow_up_date: day(0) });
    const on = await userWithReminders();
    await createApplication(on.auth, { follow_up_date: day(0), status: 'rejected' });
    const demo = await api().post('/api/auth/demo');
    await pool.query('UPDATE users SET reminders_enabled = TRUE WHERE id = $1', [demo.body.user.id]);
    await pool.query('UPDATE applications SET follow_up_date = CURRENT_DATE WHERE user_id = $1', [demo.body.user.id]);

    const { sent, send } = fakeSender();
    await sendDueReminders(send);
    expect(sent).toEqual([]);
  });

  it('catches up on the last 3 days and sends at most 5 per user', async () => {
    const { auth } = await userWithReminders();
    for (let i = 0; i < 7; i++) await createApplication(auth, { company_name: `Co ${i}`, follow_up_date: day(-(i % 3)) });
    await createApplication(auth, { company_name: 'Too old', follow_up_date: day(-5) });
    const { sent, send } = fakeSender();
    await sendDueReminders(send);
    expect(sent).toHaveLength(5);
    expect(sent.some((m) => m.subject.includes('Too old'))).toBe(false);
  });

  it('sends again when the follow-up date changes', async () => {
    const { auth } = await userWithReminders();
    const app = await createApplication(auth, { follow_up_date: day(0) });
    await sendDueReminders(fakeSender().send);
    await api().put(`/api/applications/${app.id}`).set('Authorization', auth).send({ follow_up_date: day(-1) });
    const again = fakeSender();
    expect((await sendDueReminders(again.send)).sent).toBe(1);
  });

  it('keeps going when one email fails, and retries it next time', async () => {
    const { auth } = await userWithReminders();
    await createApplication(auth, { company_name: 'Fails', follow_up_date: day(0) });
    await createApplication(auth, { company_name: 'Works', follow_up_date: day(0) });
    const flaky: SendEmail = async (_to, subject) => {
      if (subject.includes('Fails')) throw new Error('SMTP down');
    };
    expect(await sendDueReminders(flaky)).toEqual({ due: 2, sent: 1, failed: 1 });
    expect((await sendDueReminders(fakeSender().send)).sent).toBe(1);
  });
});
