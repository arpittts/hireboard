import { MockEmbeddingModelV4 } from 'ai/test';
import { afterEach, describe, expect, it } from 'vitest';
import { setEmbeddingModelForTests } from '../src/ai/provider.js';
import { pool } from '../src/db/pool.js';
import { fuse } from '../src/services/search.js';
import { api, createApplication, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();
afterEach(() => setEmbeddingModelForTests(null));

// A fake embedding model with three "topics": texts about assistants built on
// language models point one way, mobile apps another, everything else a third.
function fakeEmbeddings() {
  const vector = (text: string) => {
    const v = new Array(768).fill(0);
    if (/chatbot|llm|rag|assistant/i.test(text)) v[0] = 1;
    else if (/mobile|android|ios/i.test(text)) v[1] = 1;
    else v[2] = 1;
    return v;
  };
  const model = new MockEmbeddingModelV4({ doEmbed: async ({ values }) => ({ embeddings: values.map(vector), warnings: [] }) });
  setEmbeddingModelForTests(model);
  return model;
}

describe('fuse (reciprocal rank fusion)', () => {
  it('ranks ids found by both lists first, then by rank (ties keep list order)', () => {
    expect(fuse([['a', 'b', 'c'], ['c', 'd']])).toEqual(['c', 'a', 'b', 'd']);
  });
  it('keeps a single list in order', () => {
    expect(fuse([['x', 'y'], []])).toEqual(['x', 'y']);
  });
});

async function threeApplications() {
  const user = await createUser();
  const rag = await createApplication(user.auth, { company_name: 'Fernway', role: 'GenAI Intern', job_description: 'Build RAG pipelines over support tickets with an LLM.' });
  const kafka = await createApplication(user.auth, { company_name: 'Ledgerly', role: 'Backend Intern', job_description: 'Payments services on Kafka and Postgres.' });
  const mobile = await createApplication(user.auth, { company_name: 'Saffron', role: 'Mobile Developer', job_description: 'Ship our Android and iOS app.' });
  return { ...user, rag, kafka, mobile };
}

describe('search API', () => {
  it('finds matches by meaning that share no words with the query', async () => {
    fakeEmbeddings();
    const { auth, rag } = await threeApplications();
    const res = await api().get('/api/search').query({ q: 'chatbot jobs' }).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hybrid');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ id: rag.id, matchedBy: ['meaning'], similarity: 1 });
    expect(res.body.results[0]).not.toHaveProperty('embedding');
  });

  it('marks results found by both methods and highlights the keyword', async () => {
    fakeEmbeddings();
    const { auth, rag } = await threeApplications();
    const res = await api().get('/api/search').query({ q: 'RAG' }).set('Authorization', auth);
    expect(res.body.results[0]).toMatchObject({ id: rag.id, matchedBy: ['keyword', 'meaning'] });
    expect(res.body.results[0].snippet).toContain('[[RAG]]');
  });

  it('embeds each application once, and again only after it changes', async () => {
    const model = fakeEmbeddings();
    const { auth, kafka } = await threeApplications();
    await api().get('/api/search').query({ q: 'Kafka' }).set('Authorization', auth);
    await api().get('/api/search').query({ q: 'Kafka' }).set('Authorization', auth);
    const embedded = () => model.doEmbedCalls.flatMap((c) => c.values).filter((v) => v.startsWith('title:')).length;
    expect(embedded()).toBe(3);
    // The repeated query came from the cache: one query embedding in total.
    expect(model.doEmbedCalls.flatMap((c) => c.values).filter((v) => v.startsWith('task:'))).toHaveLength(1);

    await api().put(`/api/applications/${kafka.id}`).set('Authorization', auth).send({ notes: 'Referral from Priya.' });
    await api().get('/api/search').query({ q: 'Kafka' }).set('Authorization', auth);
    expect(embedded()).toBe(4);
  });

  it('falls back to keyword search, accepting some of the words, when AI is off', async () => {
    const { auth, kafka } = await threeApplications(); // no fake model: AI is not configured
    const res = await api().get('/api/search').query({ q: 'Kafka streaming' }).set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('keyword');
    expect(res.body.results.map((r: { id: string }) => r.id)).toEqual([kafka.id]);
    expect(res.body.results[0].matchedBy).toEqual(['keyword']);
  });

  it("only searches the user's own applications", async () => {
    fakeEmbeddings();
    await threeApplications();
    const other = await createUser();
    const res = await api().get('/api/search').query({ q: 'Kafka' }).set('Authorization', other.auth);
    expect(res.body.results).toEqual([]);
  });

  it('rejects a query that is too short, and needs a login', async () => {
    const { auth } = await createUser();
    const res = await api().get('/api/search').query({ q: 'a' }).set('Authorization', auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect((await api().get('/api/search').query({ q: 'Kafka' })).status).toBe(401);
  });

  it('counts embedding calls against the daily AI limit', async () => {
    fakeEmbeddings();
    const { auth, user } = await threeApplications();
    await pool.query('UPDATE users SET ai_daily_limit = 0 WHERE id = $1', [user.id]);
    const res = await api().get('/api/search').query({ q: 'Kafka' }).set('Authorization', auth);
    expect(res.body.mode).toBe('keyword'); // the limit stops meaning search, not search itself
  });
});
