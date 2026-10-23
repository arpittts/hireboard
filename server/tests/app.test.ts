import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { api, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('app basics', () => {
  it('reports health', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('sets security headers', async () => {
    const res = await api().get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows the frontend origin and refuses others with 403', async () => {
    const allowed = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const refused = await api().get('/api/health').set('Origin', 'https://evil.example');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CORS');
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await api().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('runs migrations only once', async () => {
    // useTestDatabase already migrated; a second run has nothing left to apply.
    expect(await runMigrations()).toEqual([]);
  });
});
