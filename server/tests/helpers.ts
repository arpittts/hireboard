import request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

export const app = createApp({ authRateLimit: 1000 });
export const api = () => request(app);

// Every test file starts from an empty, fully migrated database.
export function useTestDatabase() {
  beforeAll(async () => {
    await runMigrations();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, llm_calls, llm_cache CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });
}

let counter = 0;

// Registers a fresh user and returns its token, for tests that need someone logged in.
export async function createUser(name = 'Test User') {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.com`;
  const res = await api().post('/api/auth/register').send({ name, email, password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user, email, auth: `Bearer ${res.body.token}` };
}

export async function createApplication(auth: string, body: Record<string, unknown> = {}) {
  const res = await api()
    .post('/api/applications')
    .set('Authorization', auth)
    .send({ company_name: 'Acme', role: 'Software Engineer Intern', ...body });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
