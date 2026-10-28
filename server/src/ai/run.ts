import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APICallError, generateText, NoObjectGeneratedError, Output, simulateReadableStream, streamText, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { aiConfigured, getModel, modelName } from './provider.js';

// Every AI feature calls the model through runStructured(). In one place it:
//   1. returns a cached answer for an input it has seen before (free, instant),
//   2. enforces the per-user and global daily quotas,
//   3. calls the model and validates the reply against a Zod schema,
//      retrying once with the validation error if the reply doesn't fit,
//   4. logs every call (tokens, latency, status) to llm_calls.

const here = path.dirname(fileURLToPath(import.meta.url));
// server/prompts and <repo>/evals/recordings, from both src/ai and dist/ai.
const PROMPTS_DIR = path.resolve(here, '../../prompts');
export const RECORDINGS_DIR = path.resolve(here, '../../../evals/recordings');

// The free tier is usually 3-12 s but slows down under load, so allow up to 45 s.
const TIMEOUT_MS = 45_000;
// Quotas reset at midnight India time.
const START_OF_TODAY_SQL = "date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'";

export function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

export interface RunOptions<T> {
  feature: string; // e.g. 'jd_extract'
  promptVersion: string; // e.g. 'jd_extract.v1' (the prompt file name)
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  userId: string | null; // null for evals
  cacheInput: unknown; // everything that changes the answer
  useCache?: boolean;
  // Lower means more repeatable answers (used for grading). Default: the model's own.
  temperature?: number;
}

export interface RunResult<T> {
  data: T;
  cached: boolean;
  model: string;
  promptVersion: string;
}

interface CallLog {
  userId: string | null;
  feature: string;
  promptVersion: string;
  status: 'ok' | 'schema_error' | 'quota' | 'provider_error' | 'error';
  cached?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  error?: string;
}

export async function logCall(log: CallLog): Promise<void> {
  await pool.query(
    `INSERT INTO llm_calls (user_id, feature, model, prompt_version, input_tokens, output_tokens, latency_ms, cached, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      log.userId, log.feature, modelName(), log.promptVersion, log.inputTokens ?? null, log.outputTokens ?? null,
      log.latencyMs ?? null, log.cached ?? false, log.status, log.error?.slice(0, 1000) ?? null,
    ],
  );
}

// Real model calls (not cache hits, not refusals) since midnight India time.
export async function callsToday(userId?: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM llm_calls
     WHERE created_at >= ${START_OF_TODAY_SQL} AND NOT cached AND status <> 'quota'
       AND ($1::uuid IS NULL OR user_id = $1)`,
    [userId ?? null],
  );
  return result.rows[0].n;
}

export async function checkQuota(userId: string, feature: string, promptVersion: string): Promise<void> {
  const user = await pool.query<{ ai_daily_limit: number }>('SELECT ai_daily_limit FROM users WHERE id = $1', [userId]);
  const limit = user.rows[0]?.ai_daily_limit ?? 0;
  if ((await callsToday(userId)) >= limit) {
    await logCall({ userId, feature, promptVersion, status: 'quota', error: 'user daily limit' });
    throw new AppError(429, 'AI_QUOTA', `You've used today's ${limit} AI requests. They reset at midnight India time.`);
  }
  if ((await callsToday()) >= config.AI_GLOBAL_DAILY_LIMIT) {
    await logCall({ userId, feature, promptVersion, status: 'quota', error: 'global daily limit' });
    throw new AppError(429, 'AI_QUOTA', "HireBoard's free AI allowance is used up for today. Please try again tomorrow.");
  }
}

// --- Recorded replies --------------------------------------------------------
// In record mode every raw reply is saved to evals/recordings/<feature>/<key>-<attempt>.json.
// In replay mode a fake model answers from those files, so tests and evals run
// the real parsing and checks offline, at no cost, with the same results every time.

interface Recording {
  text: string;
  embedding?: number[]; // embedding recordings (embed.ts) have this instead of text
  inputTokens?: number;
  outputTokens?: number;
}

export const recordingPath = (feature: string, key: string, attempt: number) =>
  path.join(RECORDINGS_DIR, feature, `${key}-${attempt}.json`);

export function saveRecording(file: string, recording: Recording): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(recording, null, 2) + '\n');
}

function replayModel(file: string): LanguageModel {
  if (!fs.existsSync(file)) {
    throw new AppError(500, 'NO_RECORDING', `No recorded reply at ${path.relative(RECORDINGS_DIR, file)}. Run npm run eval:record.`);
  }
  const recording: Recording = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: recording.text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: recording.inputTokens, noCache: recording.inputTokens, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: recording.outputTokens, text: recording.outputTokens, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

// --- The model call ------------------------------------------------------------

async function callModel<T>(options: RunOptions<T>, key: string, attempt: number, feedback?: string) {
  const file = recordingPath(options.feature, key, attempt);
  const model = config.AI_MODE === 'replay' ? replayModel(file) : getModel();
  const prompt = feedback ? `${options.prompt}\n\n${feedback}` : options.prompt;
  try {
    const result = await generateText({
      model,
      system: options.system,
      prompt,
      output: Output.object({ schema: options.schema }),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      temperature: options.temperature,
    });
    if (config.AI_MODE === 'record') {
      saveRecording(file, { text: result.text, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
    }
    return { output: result.output as T, usage: result.usage };
  } catch (err) {
    // Keep bad replies too, so a replay goes down the same retry path.
    if (config.AI_MODE === 'record' && NoObjectGeneratedError.isInstance(err) && err.text !== undefined) {
      saveRecording(file, { text: err.text, inputTokens: err.usage?.inputTokens, outputTokens: err.usage?.outputTokens });
    }
    throw err;
  }
}

export async function runStructured<T>(options: RunOptions<T>): Promise<RunResult<T>> {
  const { feature, promptVersion, userId } = options;
  if (!aiConfigured()) throw new AppError(503, 'AI_DISABLED', 'AI features are not set up on this server.');

  // The full system prompt is part of the key, so editing a prompt file never
  // serves answers (or recordings) made with the old text.
  const key = crypto
    .createHash('sha256')
    .update(JSON.stringify({ feature, model: modelName(), promptVersion, system: options.system, temperature: options.temperature, input: options.cacheInput }))
    .digest('hex');
  const useCache = options.useCache ?? true;

  if (useCache) {
    const hit = await pool.query<{ response: T }>('SELECT response FROM llm_cache WHERE key = $1', [key]);
    if (hit.rows[0]) {
      await logCall({ userId, feature, promptVersion, status: 'ok', cached: true, latencyMs: 0 });
      return { data: hit.rows[0].response, cached: true, model: modelName(), promptVersion };
    }
  }

  if (userId) await checkQuota(userId, feature, promptVersion);

  let feedback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const { output, usage } = await callModel(options, key, attempt, feedback);
      await logCall({
        userId, feature, promptVersion, status: 'ok', latencyMs: Date.now() - started,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      });
      if (useCache) {
        await pool.query(
          'INSERT INTO llm_cache (key, feature, response) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
          [key, feature, JSON.stringify(output)],
        );
      }
      return { data: output, cached: false, model: modelName(), promptVersion };
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (NoObjectGeneratedError.isInstance(err)) {
        await logCall({
          userId, feature, promptVersion, status: 'schema_error', latencyMs,
          inputTokens: err.usage?.inputTokens, outputTokens: err.usage?.outputTokens, error: String(err.cause ?? err.message),
        });
        // Second try: tell the model what was wrong with its reply.
        feedback = `Your previous reply was not valid for the required JSON schema (${String(err.cause ?? err.message).slice(0, 300)}). Reply again with JSON that matches the schema exactly.`;
        continue;
      }
      throw await modelFailure(err, { userId, feature, promptVersion, latencyMs });
    }
  }
  throw new AppError(502, 'AI_BAD_OUTPUT', 'The AI gave an answer in the wrong format twice. Please try again.');
}

// Logs a failed model call and turns it into a clear AppError (shared by both runners).
export async function modelFailure(
  err: unknown,
  ctx: { userId: string | null; feature: string; promptVersion: string; latencyMs: number },
): Promise<AppError> {
  if (err instanceof AppError) return err;
  if (APICallError.isInstance(err)) {
    // Keep the provider's own explanation (for example which schema field it rejected).
    await logCall({ ...ctx, status: 'provider_error', error: `${err.statusCode} ${err.message} ${err.responseBody ?? ''}` });
    if (err.statusCode === 429) return new AppError(503, 'AI_BUSY', 'The AI service is busy right now. Please try again in a minute.');
    return new AppError(502, 'AI_ERROR', 'The AI service failed. Please try again.');
  }
  await logCall({ ...ctx, status: 'error', error: (err as Error).message });
  // AbortSignal.timeout() rejects with a TimeoutError when the model takes too long.
  if ((err as Error).name === 'TimeoutError') {
    return new AppError(504, 'AI_TIMEOUT', 'The AI took too long to answer. Please try again.');
  }
  return new AppError(502, 'AI_ERROR', 'The AI request failed. Please try again.');
}

// --- Streaming text ------------------------------------------------------------------
// For long free text (drafts): onText receives each piece as the model writes it,
// so the user sees words appear instead of waiting. Same quota, logging and
// record/replay as runStructured; no cache, because "write again" should give a
// new draft.

export interface StreamOptions {
  feature: string;
  promptVersion: string;
  system: string;
  prompt: string;
  userId: string | null;
  recordingInput: unknown; // identifies the request for record/replay
  temperature?: number;
  signal?: AbortSignal; // stops the model when the user closes the page
}

export async function runStream(options: StreamOptions, onText: (text: string) => void) {
  const { feature, promptVersion, userId } = options;
  if (!aiConfigured()) throw new AppError(503, 'AI_DISABLED', 'AI features are not set up on this server.');
  if (userId) await checkQuota(userId, feature, promptVersion);

  const key = crypto
    .createHash('sha256')
    .update(JSON.stringify({ feature, model: modelName(), promptVersion, system: options.system, temperature: options.temperature, input: options.recordingInput }))
    .digest('hex');
  const file = recordingPath(feature, key, 1);
  const started = Date.now();
  let firstTextMs: number | null = null;
  let text = '';
  try {
    const model = config.AI_MODE === 'replay' ? replayStreamModel(file) : getModel();
    const result = streamText({
      model,
      system: options.system,
      prompt: options.prompt,
      temperature: options.temperature,
      maxRetries: 1,
      abortSignal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    let usage: { inputTokens?: number; outputTokens?: number } = {};
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        firstTextMs ??= Date.now() - started;
        text += part.text;
        onText(part.text);
      } else if (part.type === 'error') {
        throw part.error;
      } else if (part.type === 'finish') {
        usage = part.totalUsage;
      }
    }
    if (!text.trim()) throw new AppError(502, 'AI_ERROR', 'The AI returned an empty draft. Please try again.');
    if (config.AI_MODE === 'record') saveRecording(file, { text, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    await logCall({ userId, feature, promptVersion, status: 'ok', latencyMs: Date.now() - started, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    return { text, firstTextMs, model: modelName(), promptVersion };
  } catch (err) {
    throw await modelFailure(err, { userId, feature, promptVersion, latencyMs: Date.now() - started });
  }
}

// Replays a recorded text a few words at a time, like a real stream.
function replayStreamModel(file: string): LanguageModel {
  if (!fs.existsSync(file)) {
    throw new AppError(500, 'NO_RECORDING', `No recorded reply at ${path.relative(RECORDINGS_DIR, file)}. Run npm run eval:record.`);
  }
  const recording: Recording = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pieces = recording.text.match(/\S+\s*/g) ?? [recording.text];
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start' as const, id: 't' },
          ...pieces.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
          { type: 'text-end' as const, id: 't' },
          {
            type: 'finish' as const,
            finishReason: { unified: 'stop' as const, raw: undefined },
            usage: {
              inputTokens: { total: recording.inputTokens, noCache: recording.inputTokens, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: recording.outputTokens, text: recording.outputTokens, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}
