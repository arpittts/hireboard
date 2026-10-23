import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

// Every error response has the same shape:
//   { "error": { "code": "VALIDATION", "message": "...", "fields": { ... } } }

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);

export const unknownRoute: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
};

// Postgres error codes we turn into 4xx responses instead of a 500.
const PG_ERRORS: Record<string, [number, string, string]> = {
  '22P02': [400, 'VALIDATION', 'Invalid input.'], // bad uuid or number
  '22007': [400, 'VALIDATION', 'Invalid date.'],
  '22008': [400, 'VALIDATION', 'Invalid date.'],
  '23514': [400, 'VALIDATION', 'A value is not allowed.'], // CHECK constraint
  '23505': [409, 'CONFLICT', 'That already exists.'], // unique violation
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    // { "company_name": "Too small", ... } so the client can show it next to the field.
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Some fields are invalid.', fields } });
    return;
  }
  // Upload errors from multer (file too big, too many files).
  if (err?.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'The file is too large (2 MB at most).' : 'The upload could not be read.';
    res.status(400).json({ error: { code: 'VALIDATION', message } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  const pgError = typeof err?.code === 'string' ? PG_ERRORS[err.code] : undefined;
  if (pgError) {
    const [status, code, message] = pgError;
    res.status(status).json({ error: { code, message } });
    return;
  }
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Server error. Please try again.' } });
};
