import { afterEach, describe, expect, it } from 'vitest';
import { setModelForTests } from '../src/ai/provider.js';
import { buildDraftPrompt, numbersIn, unsupportedNumbers, verifyClaims } from '../src/ai/drafts.js';
import { pool } from '../src/db/pool.js';
import { api, createApplication, createUser, fakeModel, useTestDatabase } from './helpers.js';

useTestDatabase();
afterEach(() => setModelForTests(null));

const parsed = {
  sections: [
    { kind: 'experience' as const, title: 'Experience', bullets: [
      { id: 'b1', text: 'Built a RAG chatbot over 4,000 manuals with FastAPI and pgvector.' },
      { id: 'b2', text: 'Raised answer accuracy from 71% to 86% with an evaluation set.' },
    ] },
  ],
};

describe('numbers check', () => {
  it('reads numbers without commas and skips years', () => {
    expect(numbersIn('From 71% to 86% over 4,000 manuals in 2026, 1.2 s')).toEqual(['71', '86', '4000', '1.2']);
  });
  it('flags numbers that appear in no source', () => {
    expect(unsupportedNumbers('I raised accuracy to 92% over 4,000 manuals.', ['4,000 manuals; 71% to 86%'])).toEqual(['92']);
  });
});

describe('verifyClaims', () => {
  const draft = 'I built a RAG chatbot over 4,000 manuals. I also led a team of 12 engineers at a bank.';
  it('supports claims only with resume lines that exist, and drops claims not in the draft', () => {
    const claims = verifyClaims(
      { claims: [
        { text: 'built a RAG chatbot over 4,000 manuals', supported_by: ['b1'] },
        { text: 'led a team of 12 engineers at a bank', supported_by: ['b9'] },
        { text: 'won a hackathon', supported_by: ['b2'] },
      ] },
      draft,
      parsed,
    );
    expect(claims).toEqual([
      { text: 'built a RAG chatbot over 4,000 manuals', supported: true, evidence: [{ bulletId: 'b1', text: parsed.sections[0].bullets[0].text }] },
      { text: 'led a team of 12 engineers at a bank', supported: false, evidence: [] },
    ]);
  });
});

describe('buildDraftPrompt', () => {
  it('marks missing requirements and passes earlier unsupported claims to avoid', () => {
    const prompt = buildDraftPrompt({
      kind: 'cover_letter', tone: 'formal', length: 'short', candidateName: 'Riya', company: 'Acme', role: 'AI Intern',
      jobDescription: null, notes: null, contactName: null, parsed,
      requirements: [{ text: 'Kubernetes', kind: 'must', skills: [] }],
      checklist: [{ requirement: 'Kubernetes', kind: 'must', verdict: 'missing', evidence: [], reason: '' }],
      avoid: ['led a team of 12 engineers'],
    });
    expect(prompt).toContain('Kubernetes (required; NOT on the resume)');
    expect(prompt).toContain('- led a team of 12 engineers');
    expect(prompt).toContain('b2: Raised answer accuracy');
  });
});

// Reads a server-sent-events body into [{ event, data }].
const parseEvents = (body: string) =>
  body.trim().split('\n\n').map((block) => {
    const event = block.match(/^event: (.*)$/m)?.[1];
    const data = JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? 'null');
    return { event, data };
  });

const DRAFT = 'Dear team, I built a RAG chatbot over 4,000 manuals and raised accuracy to 92%. I also led a team of 12 engineers. Best, Asha';

async function withResumeAndApp() {
  const { auth, user } = await createUser('Asha');
  await pool.query('INSERT INTO resumes (user_id, title, raw_text, parsed, is_active) VALUES ($1, $2, $3, $4, TRUE)', [
    user.id, 'Main', 'resume text', JSON.stringify({ ...parsed, dropped: 0, model: 't', promptVersion: 'resume_parse.v1' }),
  ]);
  const app = await createApplication(auth, { company_name: 'Acme', role: 'AI Intern', job_description: 'We use FastAPI.' });
  return { auth, app };
}

describe('drafts API', () => {
  it('needs a resume, and says so before streaming', async () => {
    const { auth } = await createUser();
    const app = await createApplication(auth);
    const res = await api().post(`/api/applications/${app.id}/drafts`).set('Authorization', auth).send({ kind: 'cover_letter' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_RESUME');
  });

  it('streams the draft as server-sent events and saves it', async () => {
    fakeModel(DRAFT);
    const { auth, app } = await withResumeAndApp();
    const res = await api().post(`/api/applications/${app.id}/drafts`).set('Authorization', auth).send({ kind: 'outreach', tone: 'friendly' });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseEvents(res.text);
    const text = events.filter((e) => e.event === 'text').map((e) => e.data.text).join('');
    expect(text).toBe(DRAFT);
    expect(events.filter((e) => e.event === 'text').length).toBeGreaterThan(5); // really arrives in pieces
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.draft).toMatchObject({ kind: 'outreach', tone: 'friendly', length: 'medium', content: DRAFT, claims: null });
    const list = await api().get(`/api/applications/${app.id}/drafts`).set('Authorization', auth);
    expect(list.body).toHaveLength(1);
  });

  it('sends model failures as an error event', async () => {
    const { auth, app } = await withResumeAndApp(); // no fake model: AI is not configured
    const res = await api().post(`/api/applications/${app.id}/drafts`).set('Authorization', auth).send({ kind: 'follow_up' });
    const events = parseEvents(res.text);
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { error: { code: 'AI_DISABLED' } } });
  });

  it('checks claims and numbers, and clears the check after an edit', async () => {
    fakeModel(DRAFT, {
      claims: [
        { text: 'I built a RAG chatbot over 4,000 manuals', supported_by: ['b1'] },
        { text: 'I also led a team of 12 engineers', supported_by: [] },
      ],
    });
    const { auth, app } = await withResumeAndApp();
    const streamed = parseEvents((await api().post(`/api/applications/${app.id}/drafts`).set('Authorization', auth).send({ kind: 'cover_letter' })).text);
    const draft = streamed.at(-1)!.data.draft;

    const checked = await api().post(`/api/drafts/${draft.id}/check`).set('Authorization', auth);
    expect(checked.status).toBe(200);
    expect(checked.body.claims.map((c: { supported: boolean }) => c.supported)).toEqual([true, false]);
    expect(checked.body.number_flags.sort()).toEqual(['12', '92']); // neither number is in the resume or job
    expect(checked.body.checked_at).not.toBeNull();

    const edited = await api().put(`/api/drafts/${draft.id}`).set('Authorization', auth).send({ content: 'Dear team, I built a RAG chatbot over 4,000 manuals. Best, Asha' });
    expect(edited.body).toMatchObject({ claims: null, number_flags: null, checked_at: null });
  });

  it("keeps drafts private", async () => {
    fakeModel(DRAFT);
    const { auth, app } = await withResumeAndApp();
    const draft = parseEvents((await api().post(`/api/applications/${app.id}/drafts`).set('Authorization', auth).send({ kind: 'thank_you' })).text).at(-1)!.data.draft;
    const other = await createUser();
    expect((await api().get(`/api/applications/${app.id}/drafts`).set('Authorization', other.auth)).body).toEqual([]);
    expect((await api().put(`/api/drafts/${draft.id}`).set('Authorization', other.auth).send({ content: 'x' })).status).toBe(404);
    expect((await api().post(`/api/drafts/${draft.id}/check`).set('Authorization', other.auth)).status).toBe(404);
    expect((await api().delete(`/api/drafts/${draft.id}`).set('Authorization', other.auth)).status).toBe(404);
    expect((await api().delete(`/api/drafts/${draft.id}`).set('Authorization', auth)).status).toBe(200);
  });

  it('rejects an unknown kind', async () => {
    const { auth, app } = await withResumeAndApp();
    const res = await api().post(`/api/applications/${app.id}/drafts`).set('Authorization', auth).send({ kind: 'resignation_letter' });
    expect(res.status).toBe(400);
  });
});
