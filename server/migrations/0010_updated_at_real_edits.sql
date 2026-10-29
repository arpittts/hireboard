-- 0010: "last updated" means an edit by the user.
-- Refreshing a search embedding (Phase 5a) or marking a reminder as sent used to
-- move updated_at, so a search reshuffled "recently updated" lists. Bookkeeping
-- columns no longer count as an update.

CREATE OR REPLACE FUNCTION update_applications_updated_at() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['embedding', 'embedding_hash', 'reminder_sent', 'search_tsv', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['embedding', 'embedding_hash', 'reminder_sent', 'search_tsv', 'updated_at']) THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_applications_updated_at ON applications;
CREATE TRIGGER update_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_applications_updated_at();
