import { afterEach, describe, expect, it } from 'vitest';
import { setModelForTests } from '../src/ai/provider.js';
import type { JdExtraction } from '../src/ai/jdExtract.js';
import { pool } from '../src/db/pool.js';
import { api, createUser, fakeModel, useTestDatabase } from './helpers.js';

useTestDatabase();
afterEach(() => setModelForTests(null));

const PAGE = `Careers | Fernway Labs
Generative AI Intern – Bengaluru (hybrid)
We build retrieval-augmented assistants for support teams. You will write Python services and evaluate LLM answers.
Must have Python and SQL. Stipend ₹50,000 per month.`;

const reply: JdExtraction = {
  company_name: 'Fernway Labs', role: 'Generative AI Intern', location: 'Bengaluru', work_mode: 'hybrid', type: 'internship',
  salary: { raw: '₹50,000 per month', min: 50000, max: 50000, currency: 'INR', period: 'month' },
  deadline: null, url: null,
  requirements: [{ text: 'Python and SQL', kind: 'must', skills: ['Python', 'SQL'] }],
  confidence: { company_name: 'high', role: 'high', location: 'high', type: 'high', salary: 'high', deadline: 'low' },
};

async function extensionToken(auth: string) {
  const res = await api().post('/api/auth/extension-token').set('Authorization', auth);
  expect(res.status).toBe(200);
  return `Bearer ${res.body.token}`;
}

describe('extension token', () => {
  it('can save a job but nothing else', async () => {
    const { auth } = await createUser();
    const ext = await extensionToken(auth);
    for (const path of ['/api/applications', '/api/auth/me', '/api/copilot/messages', '/api/dashboard/stats']) {
      const res = await api().get(path).set('Authorization', ext);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('EXTENSION_TOKEN');
    }
    // An extension token can't mint another one either.
    expect((await api().post('/api/auth/extension-token').set('Authorization', ext)).status).toBe(403);
  });
});

describe('saving a job from the extension', () => {
  it('extracts the fields and keeps them for the web app to open', async () => {
    fakeModel(JSON.stringify(reply));
    const { auth } = await createUser();
    const ext = await extensionToken(auth);
    const saved = await api().post('/api/imports').set('Authorization', ext)
      .send({ text: PAGE, url: 'https://example.com/careers/genai-intern', title: 'Generative AI Intern | Fernway Labs' });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ company: 'Fernway Labs', role: 'Generative AI Intern' });

    // The extension token can't read it back; the user's own login can.
    expect((await api().get(`/api/imports/${saved.body.id}`).set('Authorization', ext)).status).toBe(403);
    const opened = await api().get(`/api/imports/${saved.body.id}`).set('Authorization', auth);
    expect(opened.body).toMatchObject({ url: 'https://example.com/careers/genai-intern', text: PAGE });
    expect(opened.body.result.fields).toMatchObject({ company_name: 'Fernway Labs', location: 'Bengaluru (hybrid)' });

    // Nothing is an application until the user saves the form.
    expect((await api().get('/api/applications').set('Authorization', auth)).body).toEqual([]);
  });

  it("keeps saved jobs private and expires them after a day", async () => {
    fakeModel(JSON.stringify(reply));
    const { auth } = await createUser();
    const saved = await api().post('/api/imports').set('Authorization', auth).send({ text: PAGE });
    const other = await createUser();
    expect((await api().get(`/api/imports/${saved.body.id}`).set('Authorization', other.auth)).status).toBe(404);
    await pool.query("UPDATE jd_imports SET created_at = now() - interval '25 hours' WHERE id = $1", [saved.body.id]);
    expect((await api().get(`/api/imports/${saved.body.id}`).set('Authorization', auth)).status).toBe(404);
  });

  it('asks for a selection when the page has too little text, and rejects non-web URLs', async () => {
    const { auth } = await createUser();
    const short = await api().post('/api/imports').set('Authorization', auth).send({ text: 'Sign in to see this job' });
    expect(short.status).toBe(400);
    expect(short.body.error.fields.text).toContain('Select the job description');
    const bad = await api().post('/api/imports').set('Authorization', auth).send({ text: PAGE, url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
  });

  it('cuts very long pages to the job description limit', async () => {
    fakeModel(JSON.stringify(reply));
    const { auth } = await createUser();
    const saved = await api().post('/api/imports').set('Authorization', auth).send({ text: PAGE + ' filler'.repeat(5000) });
    expect(saved.status).toBe(201);
    const opened = await api().get(`/api/imports/${saved.body.id}`).set('Authorization', auth);
    expect(opened.body.text.length).toBe(20_000);
  });

  it('accepts requests from the extension origin and refuses unknown extensions', async () => {
    const ok = await api().options('/api/imports').set('Origin', 'chrome-extension://cnfkcgfemjafknicklcmdadgpokmajji').set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('chrome-extension://cnfkcgfemjafknicklcmdadgpokmajji');
    const other = await api().options('/api/imports').set('Origin', 'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh').set('Access-Control-Request-Method', 'POST');
    expect(other.status).toBe(403);
  });

  it('refuses a token whose account was deleted', async () => {
    const { auth } = await createUser();
    const ext = await extensionToken(auth);
    expect((await api().delete('/api/auth/account').set('Authorization', auth).send({ password: 'password123' })).status).toBe(200);
    const res = await api().post('/api/imports').set('Authorization', ext).send({ text: PAGE });
    expect(res.status).toBe(401);
  });
});
