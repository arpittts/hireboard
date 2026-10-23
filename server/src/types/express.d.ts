import type { AuthUser } from '../middleware/auth.js';

// Lets route handlers use req.user after requireAuth has run.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
