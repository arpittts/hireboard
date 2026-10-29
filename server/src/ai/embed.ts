import crypto from 'node:crypto';
import fs from 'node:fs';
import { embedMany } from 'ai';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { EMBEDDING_DIMENSIONS, embeddingsConfigured, getEmbeddingModel } from './provider.js';
import { checkQuota, logCall, modelFailure, recordingPath, saveRecording } from './run.js';

// Text → 768 numbers that place similar meanings close together (embeddings).
// Same habits as the other AI calls: quotas, logging, record/replay for offline
// evals, and a cache for search queries so repeating a search is free.

const BATCH_SIZE = 100;

// gemini-embedding-2 works best with these short prefixes (Google's guidance).
export const asQuery = (q: string) => `task: search result | query: ${q}`;
export const asDocument = (title: string, text: string) => `title: ${title} | text: ${text}`;

const keyOf = (text: string) =>
  crypto.createHash('sha256').update(JSON.stringify({ model: config.EMBEDDING_MODEL, dims: EMBEDDING_DIMENSIONS, text })).digest('hex');

export async function embedTexts(
  texts: string[],
  { userId, cacheQueries = false }: { userId: string | null; cacheQueries?: boolean },
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!embeddingsConfigured()) throw new AppError(503, 'AI_DISABLED', 'AI features are not set up on this server.');
  const keys = texts.map(keyOf);
  const result: (number[] | null)[] = texts.map(() => null);

  // Replay: every vector comes from evals/recordings/embed/<key>.json.
  if (config.AI_MODE === 'replay') {
    return keys.map((key) => {
      const file = recordingPath('embed', key, 1);
      if (!fs.existsSync(file)) throw new AppError(500, 'NO_RECORDING', `No recorded embedding for ${key}. Run the eval in record mode.`);
      return JSON.parse(fs.readFileSync(file, 'utf8')).embedding;
    });
  }

  // Record mode skips the cache so every vector the eval uses gets a recording.
  if (cacheQueries && config.AI_MODE !== 'record') {
    const hits = await pool.query<{ key: string; response: number[] }>('SELECT key, response FROM llm_cache WHERE key = ANY($1)', [keys]);
    const byKey = new Map(hits.rows.map((r) => [r.key.trim(), r.response]));
    keys.forEach((k, i) => { result[i] = byKey.get(k) ?? null; });
  }

  const missing = result.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    const batch = missing.slice(start, start + BATCH_SIZE);
    if (userId) await checkQuota(userId, 'embed', config.EMBEDDING_MODEL);
    const started = Date.now();
    try {
      const { embeddings } = await embedMany({
        model: getEmbeddingModel(),
        values: batch.map((i) => texts[i]),
        providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS } },
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(30_000),
      });
      await logCall({ userId, feature: 'embed', promptVersion: config.EMBEDDING_MODEL, status: 'ok', latencyMs: Date.now() - started });
      batch.forEach((i, j) => {
        result[i] = embeddings[j];
        if (config.AI_MODE === 'record') saveRecording(recordingPath('embed', keys[i], 1), { text: '', embedding: embeddings[j] });
      });
      if (cacheQueries) {
        for (const i of batch) {
          await pool.query('INSERT INTO llm_cache (key, feature, response) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING', [keys[i], 'embed_query', JSON.stringify(result[i])]);
        }
      }
    } catch (err) {
      throw await modelFailure(err, { userId, feature: 'embed', promptVersion: config.EMBEDDING_MODEL, latencyMs: Date.now() - started });
    }
  }
  return result as number[][];
}

// pgvector accepts "[0.1,0.2,...]".
export const toVector = (embedding: number[]) => `[${embedding.join(',')}]`;
