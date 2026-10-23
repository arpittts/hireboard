import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { config } from '../config.js';

// Which model every AI feature uses. Only Gemini (free tier) is wired up;
// another provider would be added here without touching the features.

let testModel: LanguageModel | null = null;

// Tests swap in a fake model (MockLanguageModelV4) so they never call the network.
export function setModelForTests(model: LanguageModel | null): void {
  testModel = model;
}

export const modelName = () => config.LLM_MODEL;

export function aiConfigured(): boolean {
  return Boolean(testModel || config.GEMINI_API_KEY || config.AI_MODE === 'replay');
}

export function getModel(): LanguageModel {
  if (testModel) return testModel;
  const google = createGoogleGenerativeAI({ apiKey: config.GEMINI_API_KEY });
  return google(config.LLM_MODEL);
}
