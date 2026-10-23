import { z } from 'zod';
import { loadPrompt, runStructured } from './run.js';
import { allBullets, type ParsedResume } from './resumeParse.js';
import type { CheckedRequirement, Requirement } from './requirementsCheck.js';

// Job + resume + checklist → the questions an interviewer is likely to ask.
// The model writes them; code removes duplicates and made-up resume citations,
// and makes sure every required skill the resume is missing gets a question.

export const PROMPT_VERSION = 'question_bank.v1';

// No .max() limits: Gemini rejects them inside arrays (see resumeParse.ts).
export const bankSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['behavioral', 'technical', 'resume', 'role']),
      requirement: z.string().nullable(),
      why_asked: z.string(),
      resume_line: z.string().nullable(),
    }),
  ),
});

export type QuestionKind = 'behavioral' | 'technical' | 'resume' | 'role' | 'gap' | 'custom';

export interface Question {
  id: string;
  text: string;
  kind: QuestionKind;
  requirement: string | null; // the requirement's text
  whyAsked: string;
  resumeLine: { id: string; text: string } | null;
}

const MAX_QUESTIONS = 12;

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

// Two questions are duplicates when most of their words are shared (Jaccard ≥ 0.7).
export function isDuplicate(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / (wa.size + wb.size - shared || 1) >= 0.7;
}

export const gapQuestion = (requirement: string): string =>
  `This role asks for ${requirement.replace(/\.$/, '')}. Your resume doesn't show it yet: how would you get up to speed, and what related experience can you point to?`;

// Required skills the resume is missing, from the latest checklist.
export function missingMustRequirements(checklist: CheckedRequirement[] | null): string[] {
  return (checklist ?? []).filter((v) => v.kind === 'must' && v.verdict === 'missing').map((v) => v.requirement);
}

// The deterministic part, exported for tests.
export function verifyQuestions(
  raw: z.infer<typeof bankSchema>,
  requirements: Requirement[],
  parsed: Pick<ParsedResume, 'sections'> | null,
  checklist: CheckedRequirement[] | null,
) {
  const bullets = new Map((parsed ? allBullets(parsed) : []).map((b) => [b.id, b]));
  const kept: Omit<Question, 'id'>[] = [];
  let dropped = 0;

  for (const q of raw.questions) {
    const text = q.text.trim().slice(0, 400);
    const match = q.requirement?.trim().toLowerCase().match(/^r(\d+)$/);
    const requirement = match ? requirements[Number(match[1]) - 1]?.text ?? null : null;
    const line = q.resume_line ? bullets.get(q.resume_line.trim().toLowerCase()) : undefined;

    // Empty, repeated, or a resume question pointing at a line that doesn't exist.
    if (text.length < 10 || kept.some((k) => isDuplicate(k.text, text)) || (q.kind === 'resume' && !line)) {
      dropped += 1;
      continue;
    }
    kept.push({
      text,
      kind: q.kind,
      requirement,
      whyAsked: q.why_asked.trim().slice(0, 300),
      resumeLine: q.kind === 'resume' && line ? { id: line.id, text: line.text } : null,
    });
  }

  // Guarantee: every missing required skill is practised.
  let added = 0;
  for (const requirement of missingMustRequirements(checklist)) {
    if (!kept.some((k) => k.requirement === requirement)) {
      kept.unshift({
        text: gapQuestion(requirement),
        kind: 'gap',
        requirement,
        whyAsked: 'Checks how you handle a skill the job needs that your resume does not show yet.',
        resumeLine: null,
      });
      added += 1;
    }
  }

  const questions: Question[] = kept.slice(0, MAX_QUESTIONS).map((q, i) => ({ id: `q${i + 1}`, ...q }));
  return { questions, dropped, added };
}

export interface BankInput {
  company: string;
  role: string;
  jobDescription: string | null;
  notes: string | null;
  requirements: Requirement[];
  parsed: Pick<ParsedResume, 'sections'> | null;
  checklist: CheckedRequirement[] | null;
}

export async function generateQuestionBank(input: BankInput, { userId, useCache = true }: { userId: string | null; useCache?: boolean }) {
  const shows = new Map((input.checklist ?? []).map((v) => [v.requirement, v.verdict]));
  const requirementList = input.requirements
    .map((r, i) => {
      const verdict = shows.get(r.text);
      const status = verdict === 'met' ? 'resume shows it' : verdict === 'missing' ? 'resume MISSING it' : 'not checked';
      return `r${i + 1} (${r.kind === 'must' ? 'required' : 'nice to have'}; ${status}): ${r.text}`;
    })
    .join('\n');
  const resumeList = input.parsed
    ? input.parsed.sections.map((s) => `## ${s.title}\n${s.bullets.map((b) => `${b.id}: ${b.text}`).join('\n')}`).join('\n\n')
    : '(no resume)';

  const prompt = [
    `<job>\nCompany: ${input.company}\nRole: ${input.role}\n\nRequirements:\n${requirementList}`,
    input.jobDescription ? `\nJob description:\n${input.jobDescription.slice(0, 6000)}` : '',
    '</job>',
    `<resume>\n${resumeList}\n</resume>`,
    `<notes>\n${input.notes?.slice(0, 2000) || '(none)'}\n</notes>`,
  ].join('\n');

  const result = await runStructured({
    feature: 'question_bank',
    promptVersion: PROMPT_VERSION,
    system: loadPrompt(PROMPT_VERSION),
    prompt,
    schema: bankSchema,
    userId,
    cacheInput: { prompt },
    useCache,
  });
  const verified = verifyQuestions(result.data, input.requirements, input.parsed, input.checklist);
  return { ...verified, model: result.model, promptVersion: result.promptVersion };
}
