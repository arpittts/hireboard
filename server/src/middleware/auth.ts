import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from './errors.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  // 'extension': a token for the Chrome extension, which may only save jobs.
  scope?: 'extension';
}

export const EXTENSION_TOKEN_DAYS = 30;

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

// A long-lived token for the Chrome extension. It can only call the routes that use
// requireAuthOrExtension (saving a job), so a leaked extension token can't read or
// change the user's applications.
export function signExtensionToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, scope: 'extension' }, config.JWT_SECRET, {
    expiresIn: `${EXTENSION_TOKEN_DAYS}d`,
  });
}

// The logged-in user's id, for routes behind requireAuth.
export function userIdOf(req: Express.Request): string {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Access denied. No token provided.');
  return req.user.id;
}

function verify(header: string | undefined): AuthUser {
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Access denied. No token provided.');
  }
  try {
    return jwt.verify(header.slice('Bearer '.length), config.JWT_SECRET) as AuthUser;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new AppError(401, 'UNAUTHORIZED', expired ? 'Token expired. Please log in again.' : 'Invalid token.');
  }
}

// Checks the "Authorization: Bearer <token>" header and puts the user on req.user.
// Extension tokens are refused here.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const user = verify(req.headers.authorization);
  if (user.scope === 'extension') {
    throw new AppError(403, 'EXTENSION_TOKEN', 'This token can only save jobs from the Chrome extension.');
  }
  req.user = user;
  next();
};

// For the few routes the Chrome extension may call: accepts both kinds of token.
export const requireAuthOrExtension: RequestHandler = (req, _res, next) => {
  req.user = verify(req.headers.authorization);
  next();
};
