-- 0005: question bank and mock interviews (Phase 3b).

-- Each generated (or edited) set of likely questions for an application; the latest is used.
CREATE TABLE IF NOT EXISTS question_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  -- [{ id, text, kind: behavioral | technical | resume | role | gap | custom, requirement, whyAsked, resumeLine }]
  questions jsonb NOT NULL,
  model varchar(60),
  prompt_version varchar(40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_question_banks_app ON question_banks (application_id, created_at);

-- A mock interview. Code, not the model, moves it forward: 5 questions, at most
-- one follow-up each.
CREATE TABLE IF NOT EXISTS interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  questions jsonb NOT NULL,               -- the questions chosen for this session, in order
  current_index int NOT NULL DEFAULT 0,
  follow_up_used boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  summary jsonb,                          -- filled by feedback (Phase 3c)
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_app ON interview_sessions (application_id, created_at);

CREATE TABLE IF NOT EXISTS interview_turns (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question_index int NOT NULL,
  speaker varchar(12) NOT NULL CHECK (speaker IN ('interviewer', 'candidate')),
  kind varchar(12) NOT NULL CHECK (kind IN ('question', 'follow_up', 'answer', 'closing')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interview_turns_session ON interview_turns (session_id, id);
