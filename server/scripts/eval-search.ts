// Evaluates hybrid search against evals/datasets/search.json.
//
//   npm run eval:search          replay recorded embeddings (offline, free, repeatable)
//   npm run eval:search:record   call the live embedding model and save the vectors
//
// The 40 postings from jd_extraction.json become one user's applications. For
// each labelled query it measures recall@5 for keyword search alone, meaning
// (vector) search alone, and the fused hybrid ranking. Target: hybrid ≥ both.

import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { fuse, keywordSearch, MAX_GAP_FROM_BEST, MAX_MEANING, MIN_SIMILARITY, vectorSearch } from '../src/services/search.js';
import { pct, publishReport, readDataset, writeResults } from './evalUtils.js';

const K = 5;
const SHOWN = 10; // the app shows up to 10 results

interface Posting { id: string; text: string; expected: { company_name: unknown; role: unknown; location: unknown } }
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | null;

async function main() {
  const corpus = readDataset<{ items: Posting[] }>('jd_extraction.json').items;
  const queries = readDataset<{ items: { id: string; query: string; relevant: string[]; style: string }[] }>('search.json').items;
  await runMigrations();
  console.log(`Search eval: ${queries.length} queries over ${corpus.length} applications, mode=${config.AI_MODE}, model=${config.EMBEDDING_MODEL}\n`);

  // A throwaway user that owns the 40 applications; deleted at the end.
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash) VALUES ('Search eval', $1, 'x') RETURNING id`,
    [`search-eval-${Date.now()}@example.invalid`],
  );
  const userId = user.rows[0].id;
  const appIdByPosting = new Map<string, string>();
  const postingByAppId = new Map<string, string>();
  try {
    for (const p of corpus) {
      const created = await pool.query<{ id: string }>(
        'INSERT INTO applications (user_id, company_name, role, location, job_description) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, first(p.expected.company_name) ?? 'Undisclosed company', first(p.expected.role) ?? 'Role', first(p.expected.location), p.text],
      );
      appIdByPosting.set(p.id, created.rows[0].id);
      postingByAppId.set(created.rows[0].id, p.id);
    }

    const totals = { keyword: 0, broad: 0, meaning: 0, hybrid: 0 };
    let shownTotal = 0;
    let shownRelevant = 0;
    const rows: string[] = [];
    for (const q of queries) {
      const keyword = (await keywordSearch(userId, q.query)).map((id) => postingByAppId.get(id)!);
      const broad = (await keywordSearch(userId, q.query, { broad: true })).map((id) => postingByAppId.get(id)!);
      const meaning = (await vectorSearch(userId, q.query, { quotaUserId: null })).map((m) => postingByAppId.get(m.id)!);
      const hybrid = fuse([keyword, meaning]);
      const shown = hybrid.slice(0, SHOWN);
      shownTotal += shown.length;
      shownRelevant += shown.filter((id) => q.relevant.includes(id)).length;
      const recall = (ranking: string[]) => q.relevant.filter((r) => ranking.slice(0, K).includes(r)).length / q.relevant.length;
      const r = { keyword: recall(keyword), broad: recall(broad), meaning: recall(meaning), hybrid: recall(hybrid) };
      totals.keyword += r.keyword;
      totals.broad += r.broad;
      totals.meaning += r.meaning;
      totals.hybrid += r.hybrid;
      rows.push(`| ${q.query} | ${q.style} | ${pct(r.keyword)} | ${pct(r.broad)} | ${pct(r.meaning)} | ${pct(r.hybrid)} |`);
      console.log(`  ${q.id} ${q.query.padEnd(42)} keyword ${pct(r.keyword).padStart(6)}  broad ${pct(r.broad).padStart(6)}  meaning ${pct(r.meaning).padStart(6)}  hybrid ${pct(r.hybrid).padStart(6)}`);
    }

    const n = queries.length;
    const avg = { keyword: totals.keyword / n, broad: totals.broad / n, meaning: totals.meaning / n, hybrid: totals.hybrid / n };
    const passed = avg.hybrid >= avg.keyword && avg.hybrid >= avg.meaning;
    const report = [
      `# Search eval (${new Date().toISOString().slice(0, 10)})`,
      '',
      `Embedding model \`${config.EMBEDDING_MODEL}\` (768 dimensions), mode \`${config.AI_MODE}\`. ${n} labelled queries over the ${corpus.length} synthetic postings of \`jd_extraction.json\` (\`evals/datasets/search.json\`). As in the app, at most ${MAX_MEANING} meaning matches are kept, each with a cosine similarity of at least ${MIN_SIMILARITY} and within ${MAX_GAP_FROM_BEST} of the best match (similarities from this model are compressed into roughly 0.55–0.75, so the gap separates relevant from unrelated far better than an absolute floor).`,
      '',
      `| Method | Mean recall@${K} |`,
      '| --- | --- |',
      `| Keyword only (Postgres full-text search, every word) | ${pct(avg.keyword)} |`,
      `| Meaning only (pgvector) | ${pct(avg.meaning)} |`,
      `| **Hybrid (reciprocal rank fusion)** | **${pct(avg.hybrid)}** |`,
      '',
      `Target: hybrid ≥ both → ${passed ? 'met' : 'MISSED'}.`,
      '',
      `Noise: hybrid search showed ${(shownTotal / n).toFixed(1)} results per query on average (up to ${SHOWN}), ${pct(shownRelevant / Math.max(1, shownTotal))} of them relevant. With only an absolute floor of 0.55 (the first version) it showed 10.0 per query, 20.0% relevant, for 91.7% hybrid recall; the gap rule alone, 4.2 per query, 45.8% relevant. The cut-offs give up a few points of recall for far less noise.`,
      '',
      `When meaning search is unavailable (AI off, quota used up, provider down) the app falls back to keyword search that also accepts applications with only some of the words: ${pct(avg.broad)} recall@${K}. Hybrid search keeps the every-word form, because adding partial matches to the fused ranking lowered hybrid recall (85.0% in a trial run).`,
      '',
      '## Per query',
      '',
      `| Query | Kind | Keyword | Keyword, some words | Meaning | Hybrid |`,
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
      '## Caveats',
      '',
      '- Queries and relevance labels were written by the builder; 40 applications is a small corpus, so a single query moves the averages by several points.',
      '- "chatbot jobs" fails on every method: no posting says "chatbot", and the embedding puts "Research Assistant" and "Teaching Assistant" postings (similarity ~0.70) above the two RAG / LLM-assistant roles. A known weakness of embeddings with an ambiguous word.',
      '- On a set of very similar applications (the demo account: 12 software and AI internships) the cut-offs still let through up to 5 loosely related meaning matches, because every posting is close to every other.',
      '- Keyword search requires every word of the query, so multi-word phrasings ("writing documentation") often match nothing; hybrid relies on meaning search for those.',
      '',
    ].join('\n');
    writeResults('search', 'Smart search', [], [
      { id: 'hybrid_recall', label: 'Hybrid recall@5', value: avg.hybrid, format: 'pct', better: 'higher' },
      { id: 'hybrid_margin', label: 'Hybrid recall minus the better single method', value: avg.hybrid - Math.max(avg.keyword, avg.meaning), format: 'pct', better: 'higher', target: { op: '>=', value: 0 } },
      { id: 'keyword_recall', label: 'Keyword-only recall@5', value: avg.keyword, format: 'pct', better: 'none' },
      { id: 'meaning_recall', label: 'Meaning-only recall@5', value: avg.meaning, format: 'pct', better: 'none' },
      { id: 'fallback_recall', label: 'Recall@5 without AI (keyword, some words)', value: avg.broad, format: 'pct', better: 'higher' },
      { id: 'shown_relevant', label: 'Share of shown results that are relevant', value: shownRelevant / Math.max(1, shownTotal), format: 'pct', better: 'higher' },
    ]);
    publishReport('search.md', report);
    process.exitCode = passed ? 0 : 1;
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
