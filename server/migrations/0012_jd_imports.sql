-- 0012: jobs saved from the Chrome extension (Phase 7).
-- The extension sends a page's text; the server extracts the fields and keeps the
-- result here until the user opens it in HireBoard, checks it and saves the
-- application. Imports older than a day are deleted by the daily cleanup job.

CREATE TABLE IF NOT EXISTS jd_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_url text,
  page_title varchar(300),
  text text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jd_imports_created ON jd_imports (created_at);
