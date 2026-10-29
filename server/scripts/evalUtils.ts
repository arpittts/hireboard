// Shared helpers for the eval scripts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { AppError } from '../src/middleware/errors.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const readDataset = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'evals/datasets', name), 'utf8'));

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs a model call, waiting and retrying on free-tier rate limits and the odd hung
// request. Between live calls it pauses to stay under the per-minute limit.
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await fn();
      if (config.AI_MODE !== 'replay') await sleep(8_000);
      return result;
    } catch (err) {
      if (err instanceof AppError && ['AI_BUSY', 'AI_TIMEOUT'].includes(err.code) && attempt < 4) {
        console.log(`  ${label}: ${err.code}, waiting 30 s and retrying`);
        await sleep(30_000);
        continue;
      }
      throw err;
    }
  }
}

// Prints the report. A live run (record mode) updates the committed copy; a replay
// does too with --write-report (for example after the owner adds grades).
export function publishReport(fileName: string, report: string): void {
  console.log(`\n${report}`);
  if (config.AI_MODE !== 'record' && !process.argv.includes('--write-report')) return;
  const file = path.join(ROOT, 'evals/reports', fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, report);
  console.log(`Report written to ${path.relative(ROOT, file)}`);
}

// --- Machine-readable results (read by scripts/eval-all.ts) ----------------------

export interface Metric {
  id: string; // stable, e.g. 'field_accuracy'
  label: string;
  value: number;
  format: 'pct' | 'count' | 'number';
  // Which way is a regression? 'none' for numbers that are only reported.
  better: 'higher' | 'lower' | 'none';
  target?: { op: '>=' | '<=' | '=='; value: number };
}

export const RESULTS_DIR = path.join(ROOT, 'evals/.results');
export const PROMPTS_DIR = path.join(ROOT, 'server/prompts');
// Which prompt text and models the committed recordings were made with.
export const MANIFEST_FILE = path.join(ROOT, 'evals/recordings/manifest.json');

export interface Manifest { model: string; embeddingModel: string; prompts: Record<string, string> }

export const promptHash = (name: string) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8')).digest('hex').slice(0, 16);

export const meetsTarget = (m: Metric) =>
  !m.target ||
  (m.target.op === '>=' ? m.value >= m.target.value : m.target.op === '<=' ? m.value <= m.target.value : m.value === m.target.value);

// Writes this eval's numbers for the combined report. A record run also notes the
// prompt text it recorded with, so a later prompt edit is caught before replay.
export function writeResults(evalId: string, title: string, prompts: string[], metrics: Metric[]): void {
  const rounded = metrics.map((m) => ({ ...m, value: Math.round(m.value * 10_000) / 10_000 }));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${evalId}.json`),
    JSON.stringify({ eval: evalId, title, prompts, metrics: rounded, passed: rounded.every(meetsTarget) }, null, 2) + '\n',
  );
  if (config.AI_MODE === 'record') {
    const manifest: Manifest = fs.existsSync(MANIFEST_FILE)
      ? JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
      : { model: config.LLM_MODEL, embeddingModel: config.EMBEDDING_MODEL, prompts: {} };
    for (const p of prompts) manifest.prompts[p] = promptHash(p);
    manifest.model = config.LLM_MODEL;
    manifest.embeddingModel = config.EMBEDDING_MODEL;
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  }
}
