-- 0003: the shared AI layer and job-description capture.

-- How many AI requests a user may make per day (demo accounts get fewer).
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_daily_limit int NOT NULL DEFAULT 40;

-- The pasted job description, what the AI extracted from it, and where the application came from.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS job_description text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS jd_extraction jsonb;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'manual';
DO $$ BEGIN
  ALTER TABLE applications ADD CONSTRAINT applications_source_check
    CHECK (source IN ('manual', 'jd_paste', 'extension', 'copilot'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One row per model call (or quota refusal): the basis for quotas, usage and evals.
CREATE TABLE IF NOT EXISTS llm_calls (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  feature varchar(40) NOT NULL,
  model varchar(60) NOT NULL,
  prompt_version varchar(20),
  input_tokens int,
  output_tokens int,
  latency_ms int,
  cached boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL,            -- ok | schema_error | quota | provider_error | error
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_created ON llm_calls (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls (created_at);

-- Validated model replies keyed by a hash of (feature, model, prompt version, input).
-- The same input never costs a second call.
CREATE TABLE IF NOT EXISTS llm_cache (
  key char(64) PRIMARY KEY,
  feature varchar(40) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
