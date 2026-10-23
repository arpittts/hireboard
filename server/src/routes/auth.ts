import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { requireAuth, signToken, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import type { RequestHandler } from 'express';

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

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  created_at: string;
}

// The shape the client stores (camelCase, never the password hash).
const toPublicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarColor: u.avatar_color,
  createdAt: u.created_at,
});

interface AuthLimiters {
  login: RequestHandler;
  register: RequestHandler;
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
         RETURNING id, name, email, avatar_color, created_at`,
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
      'SELECT id, name, email, password_hash, avatar_color, created_at FROM users WHERE email = $1',
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
      'SELECT id, name, email, avatar_color, created_at FROM users WHERE id = $1',
      [userIdOf(req)],
    );
    if (!result.rows[0]) throw notFound('User');
    res.json(toPublicUser(result.rows[0]));
  });

  router.put('/profile', requireAuth, async (req, res) => {
    const body = profileSchema.parse(req.body);
    try {
      const result = await pool.query<UserRow>(
        `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email) WHERE id = $3
         RETURNING id, name, email, avatar_color, created_at`,
        [body.name ?? null, body.email ?? null, userIdOf(req)],
      );
      if (!result.rows[0]) throw notFound('User');
      res.json(toPublicUser(result.rows[0]));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new AppError(409, 'CONFLICT', 'Email already in use.');
      throw err;
    }
  });

  return router;
}
