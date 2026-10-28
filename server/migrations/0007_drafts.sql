-- 0007: grounded writing assistant (Phase 4).

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  -- The resume the draft was written from: the claim check uses the same one.
  resume_id uuid REFERENCES resumes(id) ON DELETE SET NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('cover_letter', 'outreach', 'follow_up', 'thank_you')),
  tone varchar(10) NOT NULL DEFAULT 'formal' CHECK (tone IN ('formal', 'friendly')),
  length varchar(10) NOT NULL DEFAULT 'medium' CHECK (length IN ('short', 'medium')),
  content text NOT NULL,
  -- After the claim check: [{ text, supported, evidence: [{ bulletId, text }] }] and
  -- numbers that appear in no source. Null until checked, and again after an edit.
  claims jsonb,
  number_flags jsonb,
  checked_at timestamptz,
  model varchar(60),
  prompt_version varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drafts_app ON drafts (application_id, created_at);
