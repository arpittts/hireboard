import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from './errors.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

// The logged-in user's id, for routes behind requireAuth.
export function userIdOf(req: Express.Request): string {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Access denied. No token provided.');
  return req.user.id;
}

// Checks the "Authorization: Bearer <token>" header and puts the user on req.user.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Access denied. No token provided.');
  }
  try {
    req.user = jwt.verify(header.slice('Bearer '.length), config.JWT_SECRET) as AuthUser;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new AppError(401, 'UNAUTHORIZED', expired ? 'Token expired. Please log in again.' : 'Invalid token.');
  }
  next();
};
