import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://hireboard:hireboard@localhost:5433/hireboard_test',
      JWT_SECRET: 'test-secret',
      CLIENT_URL: 'http://localhost:5173',
      CRON_SECRET: 'test-cron-secret-0123456789',
      SMTP_HOST: '',
    },
  },
});
