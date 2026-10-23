-- 0002: demo accounts and opt-in email reminders.

-- Demo users are created by "Try the demo" and deleted after 24 hours.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_demo_created_at ON users (created_at) WHERE is_demo;

-- Reminders are off until the user turns them on in Settings.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT false;
