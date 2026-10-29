-- 0009: copilot chat and confirmed actions (Phase 5b).

-- One running conversation per user. Only the text is kept; tool results are
-- fetched fresh on every turn.
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  -- Assistant turns: the tools it used, for the "looked up…" line in the chat.
  tools_used jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages (user_id, created_at);

-- Changes the copilot proposes. Nothing changes until the user confirms the card;
-- an unconfirmed proposal expires after 30 minutes.
CREATE TABLE IF NOT EXISTS pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('status_change', 'follow_up', 'create_application')),
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  summary text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  -- The application a confirmed action changed or created.
  result_application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pending_actions_user ON pending_actions (user_id, created_at);
