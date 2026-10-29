import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { simulateReadableStream, wrapLanguageModel, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { config } from '../config.js';
import { AppError } from '../middleware/errors.js';
import { getModel, modelName } from './provider.js';
import { RECORDINGS_DIR } from './run.js';

// Record/replay for multi-step calls (the copilot). An agent turn is several model
// calls, each sent the conversation so far plus earlier tool results, so each
// step is recorded on its own, keyed by everything the model was sent. In replay
// a step whose input changed (a prompt edit, different tool results) finds no
// recording and fails loudly instead of answering from a stale one.

// Stream parts as the provider sends them. 'response-metadata' carries a Date
// and 'raw' the provider's own bytes; neither changes the result, so neither is kept.
type StreamPart = { type: string; [key: string]: unknown };

function stepKey(params: { prompt: unknown; tools?: unknown; toolChoice?: unknown; temperature?: unknown }): string {
  const tools = (params.tools as { name: string; description?: string; inputSchema?: unknown }[] | undefined)?.map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
  }));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ model: modelName(), prompt: params.prompt, tools, toolChoice: params.toolChoice, temperature: params.temperature }))
    .digest('hex');
}

const stepPath = (feature: string, key: string) => path.join(RECORDINGS_DIR, feature, `${key}.json`);

// The model to use for one multi-step feature: the real one (saving each step in
// record mode) or one that answers every step from its recording (replay).
export function steppedModel(feature: string): LanguageModel {
  if (config.AI_MODE === 'replay') {
    return new MockLanguageModelV4({
      doStream: async (params) => {
        const file = stepPath(feature, stepKey(params));
        if (!fs.existsSync(file)) {
          throw new AppError(500, 'NO_RECORDING', `No recorded step at ${path.relative(RECORDINGS_DIR, file)}. Run the eval in record mode.`);
        }
        const { parts } = JSON.parse(fs.readFileSync(file, 'utf8')) as { parts: StreamPart[] };
        return { stream: simulateReadableStream({ chunks: parts as never[] }) };
      },
    });
  }
  const model = getModel();
  if (config.AI_MODE !== 'record') return model;
  return wrapLanguageModel({
    model: model as Exclude<LanguageModel, string>,
    middleware: {
      specificationVersion: 'v4',
      wrapStream: async ({ doStream, params }) => {
        // Keyed before the call: the SDK may reuse the request objects for the next step.
        const file = stepPath(feature, stepKey(params));
        const result = await doStream();
        const parts: StreamPart[] = [];
        const stream = result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              const p = part as StreamPart;
              if (p.type !== 'response-metadata' && p.type !== 'raw') parts.push(p);
              controller.enqueue(part);
            },
            flush() {
              // A failed step is not saved: replay should never reproduce an outage.
              if (!parts.some((p) => p.type === 'error')) {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, JSON.stringify({ parts }, null, 2) + '\n');
              }
            },
          }),
        );
        return { ...result, stream };
      },
    },
  });
}
