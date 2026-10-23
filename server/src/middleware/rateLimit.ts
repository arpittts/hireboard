import { rateLimit } from 'express-rate-limit';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function limiter(limit: number, skipSuccessfulRequests: boolean) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit,
    // Count only failed attempts for login, so a user who logs in normally is never blocked.
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait 15 minutes and try again.' },
      });
    },
  });
}

// Each app instance gets its own counters (tests create several apps).
export function createAuthLimiters(limit: number) {
  return { login: limiter(limit, true), register: limiter(limit, false) };
}
