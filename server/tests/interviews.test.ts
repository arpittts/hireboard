import { afterEach, describe, expect, it } from 'vitest';
import { setModelForTests } from '../src/ai/provider.js';
import { chooseQuestions, CLOSING, isSkip, leaksFeedback } from '../src/ai/interviewer.js';
import { gapQuestion, isDuplicate, verifyQuestions, type Question } from '../src/ai/questionBank.js';
import { pool } from '../src/db/pool.js';
import { api, createApplication, createUser, fakeModel, useTestDatabase } from './helpers.js';

useTestDatabase();
afterEach(() => setModelForTests(null));

const requirements = [
  { text: 'Python', kind: 'must', skills: ['Python'] },
  { text: 'Kubernetes', kind: 'must', skills: ['Kubernetes'] },
  { text: 'Docker', kind: 'nice', skills: ['Docker'] },
] as const;
const parsed = { sections: [{ kind: 'experience' as const, title: 'Experience', bullets: [{ id: 'b1', text: 'Built a FastAPI service in Python.' }] }] };
const checklist = [
  { requirement: 'Python', kind: 'must' as const, verdict: 'met' as const, evidence: [], reason: '' },
  { requirement: 'Kubernetes', kind: 'must' as const, verdict: 'missing' as const, evidence: [], reason: '' },
  { requirement: 'Docker', kind: 'nice' as const, verdict: 'missing' as const, evidence: [], reason: '' },
];

const q = (text: string, kind: string, extra: Record<string, unknown> = {}) => ({ text, kind, requirement: null, why_asked: 'Checks something.', resume_line: null, ...extra });
const bankReply = {
  questions: [
    q('Tell me about a time you missed a deadline and what you did.', 'behavioral'),
    q('Tell me about a time you disagreed with a teammate.', 'behavioral'),
    q('Tell me about a time you had to learn something fast.', 'behavioral'),
    q('Tell me about a time you owned a mistake.', 'behavioral'),
    q('How would you speed up a slow Python API endpoint?', 'technical', { requirement: 'r1' }),
    q('How do Python generators differ from lists?', 'technical', { requirement: 'r1' }),
    q('How would you containerise a Python service?', 'technical', { requirement: 'r3' }),
    q('Walk me through the FastAPI service you built.', 'resume', { resume_line: 'b1' }),
    q('Why did you choose FastAPI over Flask there?', 'resume', { resume_line: 'b1' }),
    q('What interests you about this company?', 'role'),
  ],
};

describe('verifyQuestions', () => {
  it('maps requirement ids, keeps resume citations and adds a question for each missing required skill', () => {
    const { questions, added, dropped } = verifyQuestions(bankReply as never, requirements as never, parsed, checklist);
    expect(dropped).toBe(0);
    expect(added).toBe(1); // Kubernetes is required, missing and untested; Docker is only nice-to-have
    expect(questions[0]).toMatchObject({ id: 'q1', kind: 'gap', requirement: 'Kubernetes', text: gapQuestion('Kubernetes') });
    expect(questions.find((x) => x.text.startsWith('How would you speed'))?.requirement).toBe('Python');
    expect(questions.find((x) => x.kind === 'resume')?.resumeLine).toEqual({ id: 'b1', text: 'Built a FastAPI service in Python.' });
  });

  it('drops duplicates and resume questions that cite a line that does not exist', () => {
    const { questions, dropped } = verifyQuestions(
      { questions: [q('Tell me about a time you disagreed with a teammate.', 'behavioral'), q('Tell me about a time you disagreed with your teammate.', 'behavioral'), q('Walk me through your Kafka work.', 'resume', { resume_line: 'b42' })] } as never,
      requirements as never,
      parsed,
      null,
    );
    expect(dropped).toBe(2);
    expect(questions).toHaveLength(1);
  });

  it('spots near-duplicate questions', () => {
    expect(isDuplicate('Tell me about a time you failed.', 'Tell me about a time when you failed.')).toBe(true);
    expect(isDuplicate('How do you test APIs?', 'Why did you pick Postgres?')).toBe(false);
  });
});

describe('interview rules', () => {
  it('treats only real skips as "move on"; short answers still get a chance at a follow-up', () => {
    expect(isSkip('skip')).toBe(true);
    expect(isSkip("I don't know this one")).toBe(true);
    expect(isSkip('I test it.')).toBe(false);
    expect(isSkip('I built the API myself in FastAPI over three weeks')).toBe(false);
  });

  it('blocks feedback but allows fair probing questions', () => {
    expect(leaksFeedback('Great answer! What did you measure?')).toBe(true);
    expect(leaksFeedback('The ideal answer mentions caching. Why not cache?')).toBe(true);
    expect(leaksFeedback('How did you get feedback from users?')).toBe(false);
    expect(leaksFeedback('How did you score the model accuracy?')).toBe(false);
  });

  it('starts with missing skills, then mixes question kinds', () => {
    const bank: Question[] = verifyQuestions(bankReply as never, requirements as never, parsed, checklist).questions;
    const chosen = chooseQuestions(bank, ['Kubernetes']);
    expect(chosen).toHaveLength(5);
    expect(chosen[0].kind).toBe('gap');
    expect(new Set(chosen.map((x) => x.kind)).size).toBeGreaterThanOrEqual(4);
  });
});

async function setUp() {
  const { auth } = await createUser();
  const app = await createApplication(auth, {
    company_name: 'Northwind', role: 'AI Intern', job_description: 'AI intern role',
    jd_extraction: { requirements, model: 't', promptVersion: 'jd_extract.v1', warnings: [] },
  });
  return { auth, app };
}

describe('question bank API', () => {
  it('needs a job description', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth);
    const res = await api().post(`/api/applications/${app.id}/questions`).set('Authorization', auth);
    expect(res.body.error.code).toBe('NO_JOB_DESCRIPTION');
  });

  it('generates, returns and saves edits to the bank', async () => {
    fakeModel(bankReply);
    const { auth, app } = await setUp();
    const created = await api().post(`/api/applications/${app.id}/questions`).set('Authorization', auth);
    expect(created.status).toBe(201);
    expect(created.body.questions).toHaveLength(8); // the 2 resume questions are dropped: this user has no resume

    const edited = await api().put(`/api/applications/${app.id}/questions`).set('Authorization', auth).send({
      questions: [{ id: created.body.questions[1].id, text: created.body.questions[1].text }, { text: 'How would you explain RAG to a store manager?' }],
    });
    expect(edited.body.questions.map((x: Question) => x.kind)).toEqual([created.body.questions[1].kind, 'custom']);
    const latest = await api().get(`/api/applications/${app.id}/questions`).set('Authorization', auth);
    expect(latest.body.questions).toHaveLength(2);
  });
});

describe('mock interview API', () => {
  async function startInterview(...decisions: object[]) {
    fakeModel(bankReply, ...decisions);
    const { auth, app } = await setUp();
    await api().post(`/api/applications/${app.id}/questions`).set('Authorization', auth);
    const session = await api().post(`/api/applications/${app.id}/interviews`).set('Authorization', auth);
    return { auth, app, session: session.body };
  }
  const answer = (auth: string, id: string, text: string) =>
    api().post(`/api/interviews/${id}/answer`).set('Authorization', auth).send({ answer: text });
  const longAnswer = 'I led the work myself over three weeks and measured the result carefully with the team.';

  it('asks five questions, at most one follow-up each, then closes', async () => {
    // The fake model always wants a follow-up; code must still move on after one.
    const { auth, session } = await startInterview({ action: 'follow_up', follow_up: 'What did you measure?' });
    expect(session.turns).toEqual([expect.objectContaining({ speaker: 'interviewer', kind: 'question', question_index: 0 })]);

    let state = session;
    for (let i = 0; i < 10; i++) state = (await answer(auth, session.id, longAnswer)).body;

    expect(state.status).toBe('completed');
    const interviewer = state.turns.filter((t: { speaker: string }) => t.speaker === 'interviewer');
    expect(interviewer.filter((t: { kind: string }) => t.kind === 'question')).toHaveLength(5);
    expect(interviewer.filter((t: { kind: string }) => t.kind === 'follow_up')).toHaveLength(5);
    expect(interviewer.at(-1)).toMatchObject({ kind: 'closing', content: CLOSING });
    expect((await answer(auth, session.id, longAnswer)).body.error.code).toBe('INTERVIEW_OVER');
  });

  it('moves on without calling the model when the candidate skips', async () => {
    const { auth, session } = await startInterview({ action: 'follow_up', follow_up: 'Why?' });
    const before = (await pool.query("SELECT COUNT(*)::int AS n FROM llm_calls WHERE feature = 'interviewer'")).rows[0].n;
    const state = (await answer(auth, session.id, 'skip')).body;
    expect(state.turns.at(-1)).toMatchObject({ kind: 'question', question_index: 1 });
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM llm_calls WHERE feature = 'interviewer'")).rows[0].n).toBe(before);
  });

  it('drops a follow-up that gives feedback', async () => {
    const { auth, session } = await startInterview({ action: 'follow_up', follow_up: 'Great answer! You passed this one.' });
    const state = (await answer(auth, session.id, longAnswer)).body;
    expect(state.turns.at(-1)).toMatchObject({ kind: 'question', question_index: 1 });
  });

  it('refuses a second answer before the interviewer replies, and resumes an unfinished interview', async () => {
    const { auth, app, session } = await startInterview({ action: 'next', follow_up: null });
    await pool.query("INSERT INTO interview_turns (session_id, question_index, speaker, kind, content) VALUES ($1, 0, 'candidate', 'answer', 'x')", [session.id]);
    expect((await answer(auth, session.id, longAnswer)).body.error.code).toBe('NOT_YOUR_TURN');
    const again = await api().post(`/api/applications/${app.id}/interviews`).set('Authorization', auth);
    expect(again.body.id).toBe(session.id);
  });

  it('can be ended early', async () => {
    const { auth, app, session } = await startInterview({ action: 'next', follow_up: null });
    await answer(auth, session.id, longAnswer);
    const ended = await api().post(`/api/interviews/${session.id}/end`).set('Authorization', auth);
    expect(ended.body.status).toBe('abandoned');
    const list = await api().get(`/api/applications/${app.id}/interviews`).set('Authorization', auth);
    expect(list.body[0]).toMatchObject({ status: 'abandoned', answers: 1, question_count: 5 });
  });

  it("keeps interviews private", async () => {
    const { session } = await startInterview({ action: 'next', follow_up: null });
    const other = await createUser();
    expect((await api().get(`/api/interviews/${session.id}`).set('Authorization', other.auth)).status).toBe(404);
    expect((await answer(other.auth, session.id, longAnswer)).status).toBe(404);
    expect((await api().post(`/api/interviews/${session.id}/end`).set('Authorization', other.auth)).status).toBe(404);
  });
});

describe('demo account and export', () => {
  it('has a ready question bank, so a visitor can start an interview at once', async () => {
    const demo = await api().post('/api/auth/demo');
    const auth = `Bearer ${demo.body.token}`;
    const apps = await api().get('/api/applications').set('Authorization', auth);
    const northwind = apps.body.find((a: { company_name: string }) => a.company_name === 'Northwind Analytics');
    const bank = await api().get(`/api/applications/${northwind.id}/questions`).set('Authorization', auth);
    expect(bank.body.questions.length).toBeGreaterThanOrEqual(5);
    const session = await api().post(`/api/applications/${northwind.id}/interviews`).set('Authorization', auth);
    expect(session.status).toBe(201);
    const exported = await api().get('/api/export').set('Authorization', auth);
    expect(exported.body.questionBanks).toHaveLength(1);
    expect(exported.body.interviews[0].turns).toHaveLength(1);
  });
});
