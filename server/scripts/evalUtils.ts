// Shared helpers for the eval scripts.
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
