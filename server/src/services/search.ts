import crypto from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { asDocument, asQuery, embedTexts, toVector } from '../ai/embed.js';
import { APP_COLUMNS } from '../routes/applications.js';

// Hybrid search over a user's applications:
//   keyword: Postgres full-text search (exact words, product names like "Kafka")
//   meaning: pgvector cosine similarity between embeddings ("chatbot jobs" finds RAG roles)
// The two ranked lists are merged with reciprocal rank fusion (RRF).

const CANDIDATES = 20; // taken from each list before fusing
const RRF_K = 60; // the usual constant: lowers the weight of the top few ranks
// Every application is "nearest" to something, so meaning matches are cut twice.
// With gemini-embedding-2 nearly every pair scores 0.55–0.75, so an absolute
// floor alone separates little; the gap from the best match separates far better
// (eval set: relevant median gap 0.01, unrelated 0.09). See evals/reports/search.md.
export const MIN_SIMILARITY = 0.6;
export const MAX_GAP_FROM_BEST = 0.05;
// At most this many meaning matches: in the eval a cap of 5 kept recall@5 and cut
// the results shown per query from 4.2 to 3.3.
export const MAX_MEANING = 5;

interface AppText {
  id: string;
  company_name: string;
  role: string;
  location: string | null;
  job_description: string | null;
  notes: string | null;
  embedding_hash: string | null;
}

export const documentText = (a: Omit<AppText, 'id' | 'embedding_hash'>) =>
  asDocument(`${a.company_name} – ${a.role}`, [a.location, a.job_description?.slice(0, 4000), a.notes?.slice(0, 1000)].filter(Boolean).join('\n'));

const hashOf = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

// Embeds the applications whose text changed since their last embedding.
export async function refreshEmbeddings(userId: string, { quotaUserId = userId }: { quotaUserId?: string | null } = {}): Promise<number> {
  const apps = await pool.query<AppText>(
    'SELECT id, company_name, role, location, job_description, notes, embedding_hash FROM applications WHERE user_id = $1 ORDER BY id',
    [userId],
  );
  const stale = apps.rows.map((a) => ({ id: a.id, text: documentText(a), old: a.embedding_hash })).filter((a) => hashOf(a.text) !== a.old);
  if (stale.length === 0) return 0;
  const embeddings = await embedTexts(stale.map((a) => a.text), { userId: quotaUserId });
  for (const [i, a] of stale.entries()) {
    await pool.query('UPDATE applications SET embedding = $2::vector, embedding_hash = $3 WHERE id = $1', [a.id, toVector(embeddings[i]), hashOf(a.text)]);
  }
  return stale.length;
}

// Matches applications containing every word of the query. With `broad`, those
// with only some of the words follow, so "internship in Bengaluru" still finds
// Bengaluru internships worded differently. Hybrid search uses the strict form
// (meaning search already covers rewordings, and partial matches crowded out
// precise ones in the eval); the broad form is the fallback when meaning search
// is unavailable. Search syntax ("exact phrase", -exclude) always stays strict.
export async function keywordSearch(userId: string, q: string, { broad = false } = {}): Promise<string[]> {
  const any = broad && !/["]|(^|\s)-\S/.test(q);
  const result = await pool.query<{ id: string }>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS query_all,
                       replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery AS query_any)
     SELECT id FROM applications, q
     WHERE user_id = $1 AND (search_tsv @@ query_all OR ($3 AND search_tsv @@ query_any))
     ORDER BY search_tsv @@ query_all DESC, ts_rank_cd(search_tsv, query_any) DESC, updated_at DESC, id LIMIT ${CANDIDATES}`,
    [userId, q, any],
  );
  return result.rows.map((r) => r.id);
}

export async function vectorSearch(userId: string, q: string, { quotaUserId = userId }: { quotaUserId?: string | null } = {}) {
  await refreshEmbeddings(userId, { quotaUserId });
  const [queryVector] = await embedTexts([asQuery(q)], { userId: quotaUserId, cacheQueries: true });
  const result = await pool.query<{ id: string; similarity: number }>(
    `SELECT id, 1 - (embedding <=> $2::vector) AS similarity FROM applications
     WHERE user_id = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector LIMIT ${CANDIDATES}`,
    [userId, toVector(queryVector)],
  );
  const best = result.rows[0]?.similarity ?? 0;
  return result.rows.filter((r) => r.similarity >= MIN_SIMILARITY && best - r.similarity <= MAX_GAP_FROM_BEST).slice(0, MAX_MEANING);
}

// Reciprocal rank fusion: each list adds 1 / (k + rank) for every id it contains.
export function fuse(lists: string[][]): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export interface SearchResult {
  mode: 'hybrid' | 'keyword';
  results: Record<string, unknown>[];
}

export async function hybridSearch(
  userId: string,
  q: string,
  limit = 10,
  { quotaUserId = userId }: { quotaUserId?: string | null } = {},
): Promise<SearchResult> {
  let keyword: string[];
  let meaning: { id: string; similarity: number }[] = [];
  let mode: SearchResult['mode'] = 'hybrid';
  try {
    meaning = await vectorSearch(userId, q, { quotaUserId });
    keyword = await keywordSearch(userId, q);
  } catch (err) {
    // No AI, quota used up or the provider is down: keyword results still work.
    // Not while recording an eval, though: a recording must not capture an outage.
    if (!(err instanceof AppError) || config.AI_MODE === 'record') throw err;
    mode = 'keyword';
    keyword = await keywordSearch(userId, q, { broad: true });
  }
  const ids = fuse([keyword, meaning.map((m) => m.id)]).slice(0, limit);
  if (ids.length === 0) return { mode, results: [] };

  const similarity = new Map(meaning.map((m) => [m.id, m.similarity]));
  const rows = await pool.query(
    `SELECT ${APP_COLUMNS},
            ts_headline('english', coalesce(job_description, '') || ' ' || coalesce(notes, ''), websearch_to_tsquery('english', $2),
                        'MaxWords=22, MinWords=8, StartSel=[[, StopSel=]], HighlightAll=false') AS snippet
     FROM applications WHERE id = ANY($1)`,
    [ids, q],
  );
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  return {
    mode,
    results: ids.map((id) => {
      const app = byId.get(id);
      const matchedBy = [...(keyword.includes(id) ? ['keyword'] : []), ...(similarity.has(id) ? ['meaning'] : [])];
      // A meaning-only match has nothing to highlight: show the start of the job description instead.
      const start = app.job_description ?? app.notes ?? '';
      const snippet = keyword.includes(id) ? app.snippet : start.length > 160 ? `${start.slice(0, 160).trimEnd()}…` : start;
      return { ...app, snippet: snippet || null, matchedBy, similarity: similarity.get(id) ?? null };
    }),
  };
}
