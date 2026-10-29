-- 0011: exact vector search per user.
-- The HNSW index from 0008 is approximate and covers every user's applications:
-- on a large table Postgres would take the nearest rows of all users and filter by
-- user afterwards, which can miss a user's own applications. Each user has tens of
-- applications, so reading them through idx_applications_user_id and comparing
-- every embedding is exact and fast.

DROP INDEX IF EXISTS idx_applications_embedding;
