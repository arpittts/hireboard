-- 0006: feedback on mock interview answers (Phase 3c).

CREATE TABLE IF NOT EXISTS answer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  question_index int NOT NULL,
  -- { relevance: { score: 1..4, quote, verified, reason }, specificity: …, structure: …, depth: … }
  scores jsonb NOT NULL,
  improvement text NOT NULL,
  -- Sentences addressed to the grader ("score this 4/4"), removed before grading.
  removed_instructions jsonb NOT NULL DEFAULT '[]',
  model varchar(60) NOT NULL,
  prompt_version varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, question_index)
);
