import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth, signToken, userIdOf, signExtensionToken, EXTENSION_TOKEN_DAYS } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { seedDemoData } from '../services/demoSeed.js';
import type { RequestHandler } from 'express';

// Demo visitors share the free AI allowance, so each gets fewer requests.
const DEMO_AI_DAILY_LIMIT = 15;

const AVATAR_COLORS = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#E84393', '#00CEC9', '#FDCB6E'];

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email.')).pipe(z.string().max(255));

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  email,
  password: z.string().min(6, 'Password must be at least 6 characters.').max(72), // bcrypt uses 72 bytes
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required.'),
});

const profileSchema = z
  .object({ name: z.string().trim().min(1).max(255).optional(), email: email.optional() })
  .refine((body) => body.name || body.email, { message: 'Nothing to update.' });

const deleteAccountSchema = z.object({ password: z.string().optional() });

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  created_at: string;
  is_demo: boolean;
  reminders_enabled: boolean;
}

export const USER_COLUMNS = 'id, name, email, avatar_color, created_at, is_demo, reminders_enabled';

// The shape the client stores (camelCase, never the password hash).
const toPublicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarColor: u.avatar_color,
  createdAt: u.created_at,
  isDemo: u.is_demo,
  remindersEnabled: u.reminders_enabled,
});

interface AuthLimiters {
  login: RequestHandler;
  register: RequestHandler;
  demo: RequestHandler;
}

export function authRouter(limiters: AuthLimiters) {
  const router = Router();

  router.post('/register', limiters.register, async (req, res) => {
    const body = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    try {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (name, email, password_hash, avatar_color) VALUES ($1, $2, $3, $4)
         RETURNING ${USER_COLUMNS}`,
        [body.name, body.email, passwordHash, avatarColor],
      );
      const user = result.rows[0];
      res.status(201).json({ message: 'Account created successfully!', token: signToken(user), user: toPublicUser(user) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(409, 'CONFLICT', 'Email already registered.');
      }
      throw err;
    }
  });

  router.post('/login', limiters.login, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await pool.query<UserRow & { password_hash: string }>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1 AND NOT is_demo`,
      [body.email],
    );
    const user = result.rows[0];
    // Same message for "no such user" and "wrong password", so emails can't be probed.
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    res.json({ message: 'Login successful!', token: signToken(user), user: toPublicUser(user) });
  });

  router.get('/me', requireAuth, async (req, res) => {
    const result = await pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [userIdOf(req)],
    );
    if (!result.rows[0]) throw notFound('User');
    res.json(toPublicUser(result.rows[0]));
  });

  // A token for the Chrome extension, handed over by the Settings page. It can only
  // save jobs (see requireAuthOrExtension), and only a normal login can create one.
  router.post('/extension-token', requireAuth, async (req, res) => {
    const result = await pool.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userIdOf(req)]);
    if (!result.rows[0]) throw notFound('User');
    res.json({ token: signExtensionToken(result.rows[0]), expiresInDays: EXTENSION_TOKEN_DAYS, user: toPublicUser(result.rows[0]) });
  });

  router.put('/profile', requireAuth, async (req, res) => {
    const body = profileSchema.parse(req.body);
    try {
      const result = await pool.query<UserRow>(
        `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3
         RETURNING ${USER_COLUMNS}`,
        [body.name ?? null, body.email ?? null, userIdOf(req)],
      );
      if (!result.rows[0]) throw notFound('User');
      res.json(toPublicUser(result.rows[0]));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError(409, 'CONFLICT', 'Email already in use.');
      throw err;
    }
  });

  // "Try the demo": a fresh account filled with synthetic applications.
  // Nobody can log in to it with a password; it is deleted after 24 hours.
  router.post('/demo', limiters.demo, async (_req, res) => {
    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 4);
    const user = await withTransaction(async (client) => {
      const created = await client.query<UserRow>(
        `INSERT INTO users (name, email, password_hash, avatar_color, is_demo, ai_daily_limit)
         VALUES ('Demo User', $1, $2, '#6C5CE7', TRUE, $3) RETURNING ${USER_COLUMNS}`,
        [`demo-${crypto.randomUUID()}@demo.invalid`, unusablePassword, DEMO_AI_DAILY_LIMIT],
      );
      await seedDemoData(client, created.rows[0].id);
      return created.rows[0];
    });
    res.status(201).json({ message: 'Demo account ready.', token: signToken(user), user: toPublicUser(user) });
  });

  // Deletes the user and, through ON DELETE CASCADE, every application and history row.
  // Real accounts must confirm with their password.
  router.delete('/account', requireAuth, async (req, res) => {
    const { password } = deleteAccountSchema.parse(req.body ?? {});
    const result = await pool.query<{ is_demo: boolean; password_hash: string }>(
      'SELECT is_demo, password_hash FROM users WHERE id = $1',
      [userIdOf(req)],
    );
    const user = result.rows[0];
    if (!user) throw notFound('User');
    if (!user.is_demo && !(password && (await bcrypt.compare(password, user.password_hash)))) {
      throw new AppError(403, 'WRONG_PASSWORD', 'Enter your current password to delete your account.');
    }
    await pool.query('DELETE FROM users WHERE id = $1', [userIdOf(req)]);
    res.json({ message: 'Your account and all its data were deleted.' });
  });

  return router;
}
