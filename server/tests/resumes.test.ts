import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setModelForTests } from '../src/ai/provider.js';
import { verifyBullets } from '../src/ai/resumeParse.js';
import { verifyVerdicts } from '../src/ai/requirementsCheck.js';
import { pool } from '../src/db/pool.js';
import { api, createApplication, createUser, fakeModel, useTestDatabase } from './helpers.js';

useTestDatabase();
afterEach(() => setModelForTests(null));

const RESUME_PATH = path.resolve(import.meta.dirname, '../../evals/datasets/resumes/java_backend.txt');
const RESUME = fs.readFileSync(RESUME_PATH, 'utf8');
const PDF = fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/resume.pdf'));

// What the model would return for the Java resume (bullets copied exactly).
const parseReply = {
  sections: [
    { kind: 'education', title: 'Education', bullets: ['B.E. Information Technology, Western Ghats College of Engineering, 2022 – 2026, CGPA 7.9'] },
    {
      kind: 'experience',
      title: 'Experience',
      bullets: [
        'Backend Developer Intern – Ledgerly Payments (Jan 2026 – Jun 2026)',
        '- Built REST APIs in Java 17 and Spring Boot for merchant settlement reports.',
        'Added Kafka consumers to process payment events and wrote JUnit tests for them.',
      ],
    },
    { kind: 'skills', title: 'Technical skills', bullets: ['Java, Spring Boot, Go, SQL, PostgreSQL, MySQL, Redis, Kafka, Git, Linux, AWS (EC2, S3)'] },
  ],
};

const requirements = [
  { text: 'Java or Kotlin', kind: 'must', skills: ['Java'] },
  { text: 'Kubernetes', kind: 'must', skills: ['Kubernetes'] },
  { text: 'Kafka', kind: 'nice', skills: ['Kafka'] },
];

describe('verifyBullets (only word-for-word lines can be cited)', () => {
  it('keeps exact bullets, numbers them and strips bullet symbols', () => {
    const { sections, dropped } = verifyBullets(parseReply as never, RESUME);
    expect(dropped).toBe(0);
    expect(sections.flatMap((s) => s.bullets.map((b) => b.id))).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(sections[1].bullets[1].text).toBe('Built REST APIs in Java 17 and Spring Boot for merchant settlement reports.');
  });

  it('matches lines the PDF wrapped, even mid-word', () => {
    const wrapped = RESUME.replace('2022 – 2026, CGPA 7.9', '2022 – 2026,\nCGPA 7.9').replace('AWS (EC2', 'A\nWS (EC2');
    expect(verifyBullets(parseReply as never, wrapped).dropped).toBe(0);
  });

  it('drops reworded lines and contact details', () => {
    const { sections, dropped } = verifyBullets(
      {
        sections: [
          {
            kind: 'experience',
            title: 'Experience',
            bullets: ['Built scalable REST APIs in Java and Spring Boot', 'kabir.mehta@example.com · 9000022222', 'Kafka consumers'],
          },
        ],
      },
      RESUME,
    );
    expect(dropped).toBe(2);
    expect(sections[0].bullets.map((b) => b.text)).toEqual(['Kafka consumers']);
  });
});

describe('verifyVerdicts (evidence must be real bullets)', () => {
  const parsed = verifyBullets(parseReply as never, RESUME);

  it('turns cited ids into the bullet text', () => {
    const verdicts = verifyVerdicts(
      { verdicts: [
        { requirement_id: 'r1', verdict: 'met', bullet_ids: ['b3', 'b5'], reason: 'Java at Ledgerly.' },
        { requirement_id: 'r2', verdict: 'missing', bullet_ids: [], reason: 'No Kubernetes.' },
        { requirement_id: 'r3', verdict: 'met', bullet_ids: ['b4'], reason: 'Kafka consumers.' },
      ] },
      requirements as never,
      parsed,
    );
    expect(verdicts.map((v) => v.verdict)).toEqual(['met', 'missing', 'met']);
    expect(verdicts[0].evidence[0]).toEqual({ bulletId: 'b3', text: 'Built REST APIs in Java 17 and Spring Boot for merchant settlement reports.' });
  });

  it('marks "met" with made-up ids, and requirements the model skipped, as unverified', () => {
    const verdicts = verifyVerdicts(
      { verdicts: [{ requirement_id: 'r1', verdict: 'met', bullet_ids: ['b99'], reason: 'Trust me.' }] },
      requirements as never,
      parsed,
    );
    expect(verdicts.map((v) => v.verdict)).toEqual(['unverified', 'unverified', 'unverified']);
  });
});

describe('resumes API', () => {
  it('parses pasted text and makes it the active resume', async () => {
    fakeModel(parseReply);
    const { auth } = await createUser();
    const res = await api().post('/api/resumes').set('Authorization', auth).send({ title: 'Backend', text: RESUME });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Backend', isActive: true, bulletCount: 5, dropped: 0 });
    expect(res.body.sections[2].bullets[0].id).toBe('b5');
  });

  it('reads an uploaded PDF and never stores the file', async () => {
    fakeModel(parseReply);
    const { auth, user } = await createUser();
    const res = await api().post('/api/resumes').set('Authorization', auth).field('title', 'From PDF').attach('file', PDF, 'resume.pdf');
    expect(res.status).toBe(201);
    expect(res.body.bulletCount).toBe(5);
    const stored = await pool.query('SELECT raw_text FROM resumes WHERE user_id = $1', [user.id]);
    expect(stored.rows[0].raw_text).toContain('Ledgerly Payments');
  });

  it('rejects files that are not PDFs', async () => {
    fakeModel(parseReply);
    const { auth } = await createUser();
    const res = await api().post('/api/resumes').set('Authorization', auth).field('title', 'x')
      .attach('file', Buffer.from('hello'), { filename: 'resume.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('keeps one active resume, switches it, and allows at most 3', async () => {
    fakeModel(parseReply);
    const { auth } = await createUser();
    const make = (title: string) => api().post('/api/resumes').set('Authorization', auth).send({ title, text: RESUME });
    const first = await make('One');
    await make('Two');
    await make('Three');
    expect((await make('Four')).body.error.code).toBe('LIMIT');

    let list = await api().get('/api/resumes').set('Authorization', auth);
    expect(list.body.filter((r: { isActive: boolean }) => r.isActive).map((r: { title: string }) => r.title)).toEqual(['Three']);
    await api().put(`/api/resumes/${first.body.id}/activate`).set('Authorization', auth);
    list = await api().get('/api/resumes').set('Authorization', auth);
    expect(list.body.find((r: { isActive: boolean }) => r.isActive).title).toBe('One');
    expect((await api().delete(`/api/resumes/${first.body.id}`).set('Authorization', auth)).status).toBe(200);
  });

  it("never shows one user's resume to another", async () => {
    fakeModel(parseReply);
    const a = await createUser();
    const b = await createUser();
    const resume = await api().post('/api/resumes').set('Authorization', a.auth).send({ title: 'Mine', text: RESUME });
    expect((await api().get(`/api/resumes/${resume.body.id}`).set('Authorization', b.auth)).status).toBe(404);
    expect((await api().delete(`/api/resumes/${resume.body.id}`).set('Authorization', b.auth)).status).toBe(404);
    expect((await api().get('/api/resumes').set('Authorization', b.auth)).body).toEqual([]);
  });
});

describe('requirements checklist API', () => {
  const checkReply = {
    verdicts: [
      { requirement_id: 'r1', verdict: 'met', bullet_ids: ['b2'], reason: 'Java at Ledgerly.' },
      { requirement_id: 'r2', verdict: 'missing', bullet_ids: [], reason: 'No Kubernetes.' },
      { requirement_id: 'r3', verdict: 'met', bullet_ids: ['b4'], reason: 'Kafka consumers.' },
    ],
  };
  const jdExtraction = { requirements, model: 'test', promptVersion: 'jd_extract.v1', warnings: [] };

  it('explains what is missing before it can run', async () => {
    fakeModel(parseReply);
    const { auth } = await createUser();
    const app = await createApplication(auth);
    const noResume = await api().post(`/api/applications/${app.id}/requirements`).set('Authorization', auth);
    expect(noResume.body.error.code).toBe('NO_RESUME');
    await api().post('/api/resumes').set('Authorization', auth).send({ title: 'R', text: RESUME });
    const noJd = await api().post(`/api/applications/${app.id}/requirements`).set('Authorization', auth);
    expect(noJd.body.error.code).toBe('NO_JOB_DESCRIPTION');
  });

  it('checks the requirements against the active resume and keeps the result', async () => {
    fakeModel(parseReply, checkReply);
    const { auth } = await createUser();
    await api().post('/api/resumes').set('Authorization', auth).send({ title: 'Backend', text: RESUME });
    const app = await createApplication(auth, { jd_extraction: jdExtraction, job_description: 'Java role' });

    const res = await api().post(`/api/applications/${app.id}/requirements`).set('Authorization', auth);
    expect(res.status).toBe(201);
    expect(res.body.resume_title).toBe('Backend');
    expect(res.body.verdicts.map((v: { verdict: string }) => v.verdict)).toEqual(['met', 'missing', 'met']);

    const latest = await api().get(`/api/applications/${app.id}/requirements`).set('Authorization', auth);
    expect(latest.body.verdicts[0].evidence[0].bulletId).toBe('b2');
  });

  it('reads a hand-typed job description first when there are no requirements yet', async () => {
    const jdReply = {
      company_name: null, role: 'Backend Intern', location: null, work_mode: null, type: 'internship',
      salary: { raw: null, min: null, max: null, currency: null, period: null }, deadline: null, url: null,
      requirements, confidence: { company_name: 'high', role: 'high', location: 'high', type: 'high', salary: 'high', deadline: 'high' },
    };
    fakeModel(parseReply, jdReply, checkReply);
    const { auth } = await createUser();
    await api().post('/api/resumes').set('Authorization', auth).send({ title: 'Backend', text: RESUME });
    const app = await createApplication(auth, { job_description: 'We need Java or Kotlin, Kubernetes, and Kafka is a plus. '.repeat(3) });
    const res = await api().post(`/api/applications/${app.id}/requirements`).set('Authorization', auth);
    expect(res.status).toBe(201);
    const saved = await api().get(`/api/applications/${app.id}`).set('Authorization', auth);
    expect(saved.body.jd_extraction.requirements).toHaveLength(3);
  });

  it("can't be run or read on someone else's application", async () => {
    const a = await createUser();
    const b = await createUser();
    const app = await createApplication(a.auth);
    expect((await api().get(`/api/applications/${app.id}/requirements`).set('Authorization', b.auth)).status).toBe(404);
    expect((await api().post(`/api/applications/${app.id}/requirements`).set('Authorization', b.auth)).status).toBe(404);
  });
});

describe('demo account', () => {
  it('comes with a resume and three ready-made checklists', async () => {
    const demo = await api().post('/api/auth/demo');
    const auth = `Bearer ${demo.body.token}`;
    const resumes = await api().get('/api/resumes').set('Authorization', auth);
    expect(resumes.body).toHaveLength(1);
    expect(resumes.body[0].isActive).toBe(true);
    const apps = await api().get('/api/applications').set('Authorization', auth);
    const northwind = apps.body.find((a: { company_name: string }) => a.company_name === 'Northwind Analytics');
    const check = await api().get(`/api/applications/${northwind.id}/requirements`).set('Authorization', auth);
    expect(check.body.verdicts.length).toBeGreaterThan(3);
    expect(check.body.verdicts.every((v: { verdict: string; evidence: unknown[] }) => v.verdict !== 'met' || v.evidence.length > 0)).toBe(true);
  });

  it('includes resumes in the data export', async () => {
    const demo = await api().post('/api/auth/demo');
    const res = await api().get('/api/export').set('Authorization', `Bearer ${demo.body.token}`);
    expect(res.body.resumes).toHaveLength(1);
    expect(res.body.requirementChecks).toHaveLength(3);
  });
});
