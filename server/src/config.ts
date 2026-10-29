import 'dotenv/config';
import { z } from 'zod';

// Read and check every environment variable once, at startup.
// A missing DATABASE_URL or JWT_SECRET stops the server with a clear message.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CLIENT_URL: z.string().optional(),
  // Fixed by the public key in extension/manifest.json, so every install has this id.
  EXTENSION_ID: z.string().regex(/^[a-p]{32}$/).default('cnfkcgfemjafknicklcmdadgpokmajji'),
  // Failed login/register attempts allowed per IP in 15 minutes.
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Shared with the GitHub Actions schedule; the /api/internal routes are off without it.
  CRON_SECRET: z.string().min(16).optional(),
  // AI (Phase 2). Without GEMINI_API_KEY the AI routes answer 503 and the rest of the app works.
  GEMINI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gemini-3.5-flash-lite'),
  // live: call the model. record: call it and save replies to evals/recordings.
  // replay: answer only from those recordings (tests, CI, evals); no network.
  AI_MODE: z.enum(['live', 'record', 'replay']).default('live'),
  // Search by meaning (Phase 5a). The database column holds 768 numbers.
  EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
  // Model calls allowed per day across all users, kept under the free-tier limit.
  AI_GLOBAL_DAILY_LIMIT: z.coerce.number().int().positive().default(300),
  // Email. Render's free plan blocks SMTP ports, so production uses Brevo's HTTPS API;
  // SMTP still works where those ports are open (for example locally).
  BREVO_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('HireBoard <noreply@hireboard.app>'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment:');
  for (const issue of parsed.error.issues) {
    console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
