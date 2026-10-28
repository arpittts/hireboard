import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config, isProduction } from './config.js';
import { AppError, errorHandler, unknownRoute } from './middleware/errors.js';
import { createAuthLimiters } from './middleware/rateLimit.js';
import { accountRouter } from './routes/account.js';
import { aiRouter } from './routes/ai.js';
import { applicationsRouter } from './routes/applications.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { applicationDraftsRouter, draftsRouter } from './routes/drafts.js';
import { internalRouter } from './routes/internal.js';
import { interviewsRouter, questionsRouter } from './routes/interviews.js';
import { requirementsRouter } from './routes/requirements.js';
import { resumesRouter } from './routes/resumes.js';
import { searchRouter } from './routes/search.js';

const allowedOrigins = ['http://localhost:5173', 'http://localhost:5174', config.CLIENT_URL].filter(Boolean);

// Builds the Express app without starting it, so tests can call it directly.
export function createApp({ authRateLimit = config.AUTH_RATE_LIMIT, demoRateLimit = 10 } = {}) {
  const app = express();

  // Render puts one proxy in front of the app; trust it so rate limits see the real client IP.
  if (isProduction) app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Requests without an Origin header (curl, server-to-server) are allowed.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new AppError(403, 'CORS', `Origin ${origin} is not allowed.`));
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.use('/api/auth', authRouter(createAuthLimiters(authRateLimit, demoRateLimit)));
  app.use('/api/applications', applicationsRouter);
  app.use('/api/applications', requirementsRouter);
  app.use('/api/applications', questionsRouter);
  app.use('/api/applications', applicationDraftsRouter);
  app.use('/api/interviews', interviewsRouter);
  app.use('/api/drafts', draftsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/resumes', resumesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/internal', internalRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api', accountRouter); // /api/settings, /api/export

  app.use(unknownRoute);
  app.use(errorHandler);
  return app;
}
