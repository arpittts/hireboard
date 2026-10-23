import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { emailConfigured, emailSender, parseFrom } from '../src/services/reminders.js';
import { api, createApplication, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();

const SECRET = 'test-cron-secret-0123456789';
const today = () => new Date().toISOString().slice(0, 10);

afterEach(() => {
  vi.unstubAllGlobals();
  config.BREVO_API_KEY = '';
  config.EMAIL_FROM = 'HireBoard <noreply@hireboard.app>';
});

describe('parseFrom', () => {
  it('splits "Name <email>"', () => {
    expect(parseFrom('HireBoard <me@example.com>')).toEqual({ name: 'HireBoard', email: 'me@example.com' });
    expect(parseFrom('me@example.com')).toEqual({ email: 'me@example.com' });
  });
});

describe('sending through Brevo (HTTPS, works on Render free)', () => {
  it('is used when BREVO_API_KEY is set', async () => {
    expect(emailConfigured()).toBe(false);
    config.BREVO_API_KEY = 'test-brevo-key';
    config.EMAIL_FROM = 'HireBoard <me@example.com>';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: 'abc' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await emailSender()!('you@example.com', 'Hello', '<p>Hi</p>');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('test-brevo-key');
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'HireBoard', email: 'me@example.com' },
      to: [{ email: 'you@example.com' }],
      subject: 'Hello',
      htmlContent: '<p>Hi</p>',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal); // never waits forever
  });

  it('reports a refused email as failed and retries it on the next run', async () => {
    config.BREVO_API_KEY = 'test-brevo-key';
    const { auth } = await createUser();
    await api().put('/api/settings').set('Authorization', auth).send({ remindersEnabled: true });
    await createApplication(auth, { follow_up_date: today() });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"unauthorized"}', { status: 401 })));
    const failed = await api().post('/api/internal/reminders').set('X-Cron-Secret', SECRET);
    expect(failed.body).toEqual({ due: 1, sent: 0, failed: 1 });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    const sent = await api().post('/api/internal/reminders').set('X-Cron-Secret', SECRET);
    expect(sent.body).toEqual({ due: 1, sent: 1, failed: 0 });
  });
});
