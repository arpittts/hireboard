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
  // Failed login/register attempts allowed per IP in 15 minutes.
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  // Shared with the GitHub Actions schedule; the /api/internal routes are off without it.
  CRON_SECRET: z.string().min(16).optional(),
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
