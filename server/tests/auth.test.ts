import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { api, createUser, useTestDatabase } from './helpers.js';

useTestDatabase();

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token without the password hash', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Asha', email: 'Asha@Example.com', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rejects a duplicate email (any case) with 409', async () => {
    await api().post('/api/auth/register').send({ name: 'A', email: 'dup@example.com', password: 'secret123' });
    const res = await api().post('/api/auth/register').send({ name: 'B', email: 'DUP@example.com', password: 'secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('returns 400 with field messages for invalid input', async () => {
    const res = await api().post('/api/auth/register').send({ name: '', email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with the right password', async () => {
    const { email } = await createUser();
    const res = await api().post('/api/auth/login').send({ email: email.toUpperCase(), password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const { email } = await createUser();
    const wrong = await api().post('/api/auth/login').send({ email, password: 'nope-nope' });
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it('blocks an IP after too many failed attempts, but not after successful ones', async () => {
    const limitedApp = createApp({ authRateLimit: 3 });
    const { email } = await createUser();
    for (let i = 0; i < 5; i++) {
      const ok = await request(limitedApp).post('/api/auth/login').send({ email, password: 'password123' });
      expect(ok.status).toBe(200);
    }
    for (let i = 0; i < 3; i++) {
      await request(limitedApp).post('/api/auth/login').send({ email, password: 'wrong-pass' });
    }
    const blocked = await request(limitedApp).post('/api/auth/login').send({ email, password: 'password123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/auth/me and PUT /api/auth/profile', () => {
  it('returns the current user', async () => {
    const { auth, email } = await createUser('Ravi');
    const res = await api().get('/api/auth/me').set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Ravi', email });
  });

  it('rejects missing and invalid tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    const bad = await api().get('/api/auth/me').set('Authorization', 'Bearer not.a.token');
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Invalid token.');
  });

  it('updates the name and refuses an email that is taken', async () => {
    const a = await createUser();
    const b = await createUser();
    const renamed = await api().put('/api/auth/profile').set('Authorization', a.auth).send({ name: 'New Name' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('New Name');
    const taken = await api().put('/api/auth/profile').set('Authorization', a.auth).send({ email: b.email });
    expect(taken.status).toBe(409);
    const empty = await api().put('/api/auth/profile').set('Authorization', a.auth).send({});
    expect(empty.status).toBe(400);
  });
});
