import { z } from 'zod';
import { loadPrompt, runStructured } from './run.js';
import type { Question, QuestionKind } from './questionBank.js';

// The mock interviewer. Code owns the interview: which question comes next,
// at most one follow-up per question, five questions per session. The model
// only decides, after a first answer, whether to probe once more, and writes
// that follow-up.

export const PROMPT_VERSION = 'interviewer.v1';
export const QUESTIONS_PER_SESSION = 5;
export const MAX_ANSWER_LENGTH = 2000;

export const decisionSchema = z.object({
  action: z.enum(['follow_up', 'next']),
  follow_up: z.string().nullable(),
});

// Answers that mean "move on": no follow-up, no model call. A short real answer
// ("I test it.") is not a skip: that is exactly when a follow-up helps.
const SKIP = /^\s*(skip|pass|next|i\s*(do\s*not|don'?t)\s*know|no idea|not sure|idk)\b/i;
export const isSkip = (answer: string) => SKIP.test(answer) || answer.trim().length === 0;

// Feedback, praise or hints have no place mid-interview. If the model writes
// one anyway, code drops the follow-up instead of showing it.
// Only phrases that judge the candidate's answer: "How did you get feedback from users?"
// or "How did you score the model?" are fair probes and must still pass.
const LEAK =
  /\b(great|good|excellent|nice|solid|strong|impressive|perfect)\s+(answer|job|point|response|example)\b|\bwell done\b|\byou (passed|did well|nailed)\b|\b(your|my) (score|rating|grade)\b|\b(the )?(correct|ideal|right|model) answer\b|\brubric\b|\b(out of|\/)\s*(5|10)\b/i;
export const leaksFeedback = (text: string) => LEAK.test(text);

export interface Decision {
  action: 'follow_up' | 'next';
  followUp: string | null;
  usedModel: boolean;
  blockedLeak: boolean;
}

interface DecideInput {
  company: string;
  role: string;
  question: Question;
  answer: string;
  followUpUsed: boolean;
}

export async function decideNext(input: DecideInput, { userId, useCache = true }: { userId: string | null; useCache?: boolean }): Promise<Decision> {
  // The rules that never need a model.
  if (input.followUpUsed || isSkip(input.answer)) {
    return { action: 'next', followUp: null, usedModel: false, blockedLeak: false };
  }

  const prompt = [
    `<role>${input.role} at ${input.company}</role>`,
    `<question>${input.question.text}</question>`,
    `<checks>${input.question.whyAsked}${input.question.requirement ? ` (requirement: ${input.question.requirement})` : ''}</checks>`,
    `<answer>\n${input.answer.slice(0, MAX_ANSWER_LENGTH)}\n</answer>`,
  ].join('\n');

  const result = await runStructured({
    feature: 'interviewer',
    promptVersion: PROMPT_VERSION,
    system: loadPrompt(PROMPT_VERSION),
    prompt,
    schema: decisionSchema,
    userId,
    cacheInput: { prompt },
    useCache,
  });

  const followUp = result.data.follow_up?.trim().slice(0, 300) || null;
  if (result.data.action !== 'follow_up' || !followUp) {
    return { action: 'next', followUp: null, usedModel: true, blockedLeak: false };
  }
  if (leaksFeedback(followUp)) {
    return { action: 'next', followUp: null, usedModel: true, blockedLeak: true };
  }
  return { action: 'follow_up', followUp, usedModel: true, blockedLeak: false };
}

// Pick the session's questions: gaps and missing skills first, then a mix of kinds.
export function chooseQuestions(bank: Question[], missing: string[]): Question[] {
  const priority = bank.filter((q) => q.kind === 'gap' || (q.requirement !== null && missing.includes(q.requirement)));
  const rest = bank.filter((q) => !priority.includes(q));
  const order: QuestionKind[] = ['behavioral', 'technical', 'resume', 'custom', 'role', 'gap'];
  const mixed: Question[] = [];
  // Round-robin over kinds so a session isn't five behavioural questions in a row.
  while (rest.length) {
    for (const kind of order) {
      const i = rest.findIndex((q) => q.kind === kind);
      if (i >= 0) mixed.push(...rest.splice(i, 1));
    }
  }
  // At most two "priority" questions, so the session still feels like a real interview.
  return [...priority.slice(0, 2), ...mixed, ...priority.slice(2)].slice(0, QUESTIONS_PER_SESSION);
}

export const OPENING = "Hi, thanks for making time today. I'll ask you five questions, the way an interviewer for this role might. Take your time with each answer.";
export const CLOSING = "That's all my questions. Thanks for your time!";
