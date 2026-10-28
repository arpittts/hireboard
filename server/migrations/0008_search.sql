-- 0008: hybrid search over applications (Phase 5a).

CREATE EXTENSION IF NOT EXISTS vector;

-- Keyword search: Postgres keeps this column up to date by itself. Company and
-- role weigh most (A), then location (B), then the job description and notes (C).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce(company_name, '') || ' ' || coalesce(role, '')), 'A') ||
  setweight(to_tsvector('english'::regconfig, coalesce(location, '')), 'B') ||
  setweight(to_tsvector('english'::regconfig, coalesce(job_description, '') || ' ' || coalesce(notes, '')), 'C')
) STORED;
CREATE INDEX IF NOT EXISTS idx_applications_search_tsv ON applications USING gin (search_tsv);

-- Search by meaning: one 768-number embedding per application, plus a hash of the
-- text it was made from, so only changed applications are embedded again.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS embedding_hash char(64);
CREATE INDEX IF NOT EXISTS idx_applications_embedding ON applications USING hnsw (embedding vector_cosine_ops);
