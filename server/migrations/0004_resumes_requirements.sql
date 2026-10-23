-- 0004: resumes and the requirements checklist (Phase 3a).

-- A resume is stored as text plus its parsed sections; the uploaded PDF is never kept.
CREATE TABLE IF NOT EXISTS resumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  raw_text text NOT NULL,
  -- { sections: [{ kind, title, bullets: [{ id, text }] }], dropped: n, model, promptVersion }
  parsed jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes (user_id, created_at);
-- At most one active resume per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_one_active ON resumes (user_id) WHERE is_active;

-- Each run of "Check requirements" for an application. The latest one is shown.
CREATE TABLE IF NOT EXISTS requirement_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_id uuid REFERENCES resumes(id) ON DELETE SET NULL,
  -- [{ requirement, kind, verdict: met | missing | unverified, evidence: [{ bulletId, text }], reason }]
  verdicts jsonb NOT NULL,
  model varchar(60) NOT NULL,
  prompt_version varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requirement_checks_app ON requirement_checks (application_id, created_at);

-- Prompt names like "requirements_check.v1" are longer than the 20 characters 0003 allowed.
ALTER TABLE llm_calls ALTER COLUMN prompt_version TYPE varchar(40);
