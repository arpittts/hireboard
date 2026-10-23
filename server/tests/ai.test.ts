import { APICallError } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { setModelForTests } from '../src/ai/provider.js';
import { checkExtraction, type JdExtraction } from '../src/ai/jdExtract.js';
import { pool } from '../src/db/pool.js';
import { api, createUser, fakeModel, useTestDatabase } from './helpers.js';

useTestDatabase();

const JD = `Fernway Labs is hiring a Generative AI Intern in Bengaluru (hybrid). Must have Python and SQL.
Good to have Docker. Stipend ₹50,000 per month. Apply by 15 Nov via https://example.com/fernway/apply`;

const goodReply: JdExtraction = {
  company_name: 'Fernway Labs',
  role: 'Generative AI Intern',
  location: 'Bengaluru',
  work_mode: 'hybrid',
  type: 'internship',
  salary: { raw: '₹50,000 per month', min: 50000, max: 50000, currency: 'INR', period: 'month' },
  deadline: '2026-11-15',
  url: 'https://example.com/fernway/apply',
  requirements: [
    { text: 'Python and SQL', kind: 'must', skills: ['Python', 'SQL'] },
    { text: 'Docker', kind: 'nice', skills: ['Docker'] },
  ],
  confidence: { company_name: 'high', role: 'high', location: 'high', type: 'high', salary: 'high', deadline: 'high' },
};

const extract = (auth: string, text = JD) => api().post('/api/ai/jd/extract').set('Authorization', auth).send({ text });

afterEach(() => setModelForTests(null));

describe('POST /api/ai/jd/extract', () => {
  it('turns a job description into form fields and requirements', async () => {
    fakeModel(JSON.stringify(goodReply));
    const { auth } = await createUser();
    const res = await extract(auth);
    expect(res.status).toBe(200);
    expect(res.body.fields).toEqual({
      company_name: 'Fernway Labs',
      role: 'Generative AI Intern',
      location: 'Bengaluru (hybrid)',
      type: 'internship',
      salary: '₹50,000 per month',
      deadline: '2026-11-15',
      url: 'https://example.com/fernway/apply',
    });
    expect(res.body.extraction.requirements).toHaveLength(2);
    expect(res.body).toMatchObject({ cached: false, promptVersion: 'jd_extract.v1', warnings: [] });

    const log = await pool.query('SELECT feature, status, input_tokens, output_tokens, cached FROM llm_calls');
    expect(log.rows).toEqual([{ feature: 'jd_extract', status: 'ok', input_tokens: 500, output_tokens: 120, cached: false }]);
  });

  it('retries once with feedback when the reply does not fit the schema', async () => {
    const model = fakeModel('{"company_name": "Fernway Labs"}', JSON.stringify(goodReply));
    const { auth } = await createUser();
    const res = await extract(auth);
    expect(res.status).toBe(200);
    expect(model.calls()).toBe(2);
    const log = await pool.query('SELECT status FROM llm_calls ORDER BY id');
    expect(log.rows.map((r) => r.status)).toEqual(['schema_error', 'ok']);
  });

  it('gives up with 502 after two unusable replies', async () => {
    fakeModel('not json at all');
    const { auth } = await createUser();
    const res = await extract(auth);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('AI_BAD_OUTPUT');
  });

  it('answers a repeated job description from the cache without counting it', async () => {
    const model = fakeModel(JSON.stringify(goodReply));
    const a = await createUser();
    const b = await createUser();
    await extract(a.auth);
    const second = await extract(b.auth);
    expect(second.body.cached).toBe(true);
    expect(model.calls()).toBe(1);
    const usage = await api().get('/api/ai/usage').set('Authorization', b.auth);
    expect(usage.body).toMatchObject({ usedToday: 0, cachedToday: 1 });
  });

  it("stops a user at their daily limit with 429", async () => {
    fakeModel(JSON.stringify(goodReply));
    const { auth, user } = await createUser();
    await pool.query('UPDATE users SET ai_daily_limit = 2 WHERE id = $1', [user.id]);
    expect((await extract(auth, `${JD}\nVersion 1`)).status).toBe(200);
    expect((await extract(auth, `${JD}\nVersion 2`)).status).toBe(200);
    const third = await extract(auth, `${JD}\nVersion 3`);
    expect(third.status).toBe(429);
    expect(third.body.error).toMatchObject({ code: 'AI_QUOTA' });
    expect(third.body.error.message).toContain('2 AI requests');
    // A cached answer is still allowed after the limit.
    expect((await extract(auth, `${JD}\nVersion 1`)).status).toBe(200);
  });

  it('gives demo accounts a smaller allowance', async () => {
    fakeModel(JSON.stringify(goodReply));
    const demo = await api().post('/api/auth/demo');
    const usage = await api().get('/api/ai/usage').set('Authorization', `Bearer ${demo.body.token}`);
    expect(usage.body.dailyLimit).toBe(15);
  });

  it('turns a provider rate limit into a clear 503', async () => {
    fakeModel(
      new APICallError({ message: 'Resource exhausted', url: 'https://example.com', requestBodyValues: {}, statusCode: 429, isRetryable: false }),
    );
    const { auth } = await createUser();
    const res = await extract(auth);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_BUSY');
  });

  it('answers 503 when no AI key is configured', async () => {
    const { auth } = await createUser();
    const res = await extract(auth);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_DISABLED');
  });

  it('rejects text that is too short to be a job description', async () => {
    fakeModel(JSON.stringify(goodReply));
    const { auth } = await createUser();
    const res = await extract(auth, 'Hiring now');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.text).toBeDefined();
  });
});

describe('checkExtraction (code checks after the model)', () => {
  const today = '2026-10-23';
  const check = (overrides: Partial<JdExtraction>, text = JD) => checkExtraction({ ...goodReply, ...overrides }, text, today);

  it('leaves a correct extraction alone', () => {
    expect(check({}).warnings).toEqual([]);
  });

  it('flags a company that is not in the posting', () => {
    const { data, warnings } = check({ company_name: 'Google' });
    expect(data.confidence.company_name).toBe('low');
    expect(warnings[0]).toContain('Google');
  });

  it('drops a link that the posting does not contain', () => {
    expect(check({ url: 'https://phish.example/apply' }).data.url).toBeNull();
    expect(check({ url: 'javascript:alert(1)' }).data.url).toBeNull();
  });

  it('drops impossible or very old deadlines, and warns about passed ones', () => {
    expect(check({ deadline: '2026-02-30' }).data.deadline).toBeNull();
    expect(check({ deadline: '2024-01-01' }).data.deadline).toBeNull();
    const passed = check({ deadline: '2026-10-01' });
    expect(passed.data.deadline).toBe('2026-10-01');
    expect(passed.warnings[0]).toContain('already passed');
  });

  it('clears a salary range where min is above max', () => {
    const { data } = check({ salary: { raw: '10-5 LPA', min: 1000000, max: 500000, currency: 'INR', period: 'year' } });
    expect(data.salary).toMatchObject({ raw: '10-5 LPA', min: null, max: null });
    expect(data.confidence.salary).toBe('low');
  });

  it('removes duplicate requirements', () => {
    const { data } = check({
      requirements: [
        { text: 'Python', kind: 'must', skills: ['Python', 'Python'] },
        { text: 'python', kind: 'nice', skills: [] },
      ],
    });
    expect(data.requirements).toEqual([{ text: 'Python', kind: 'must', skills: ['Python'] }]);
  });
});

describe('saving an application from a job description', () => {
  it('stores the job description, the extraction and the source', async () => {
    const { auth } = await createUser();
    const res = await api()
      .post('/api/applications')
      .set('Authorization', auth)
      .send({
        company_name: 'Fernway Labs',
        role: 'Generative AI Intern',
        job_description: JD,
        source: 'jd_paste',
        jd_extraction: { requirements: goodReply.requirements, model: 'test-model', promptVersion: 'jd_extract.v1', warnings: [] },
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: 'jd_paste', job_description: JD });
    expect(res.body.jd_extraction.requirements[0].skills).toEqual(['Python', 'SQL']);
  });

  it('defaults the source to manual and rejects unknown sources', async () => {
    const { auth } = await createUser();
    const manual = await api().post('/api/applications').set('Authorization', auth).send({ company_name: 'A', role: 'B' });
    expect(manual.body.source).toBe('manual');
    const bad = await api().post('/api/applications').set('Authorization', auth).send({ company_name: 'A', role: 'B', source: 'scraper' });
    expect(bad.status).toBe(400);
  });
});
