import { z } from 'zod';
import { loadPrompt, runStream, runStructured } from './run.js';
import { allBullets, type ParsedResume } from './resumeParse.js';
import type { CheckedRequirement, Requirement } from './requirementsCheck.js';

// The writing assistant. The draft streams from the model; afterwards two checks
// look for claims about the candidate that the resume doesn't back up:
//   1. a model lists the claims and cites resume lines by id (code checks the ids),
//   2. code flags any number that appears in no source (resume, job, notes).

export const DRAFT_PROMPT_VERSION = 'draft.v1';
export const CLAIMS_PROMPT_VERSION = 'claims.v1';
export const KINDS = ['cover_letter', 'outreach', 'follow_up', 'thank_you'] as const;
export type DraftKind = (typeof KINDS)[number];

export interface DraftInput {
  kind: DraftKind;
  tone: 'formal' | 'friendly';
  length: 'short' | 'medium';
  candidateName: string;
  company: string;
  role: string;
  jobDescription: string | null;
  notes: string | null;
  contactName: string | null;
  requirements: Requirement[];
  checklist: CheckedRequirement[] | null;
  parsed: Pick<ParsedResume, 'sections'>;
  avoid?: string[]; // unsupported claims from an earlier version, to leave out this time
}

const resumeLines = (parsed: Pick<ParsedResume, 'sections'>) =>
  parsed.sections.map((s) => `## ${s.title}\n${s.bullets.map((b) => `${b.id}: ${b.text}`).join('\n')}`).join('\n\n');

export function buildDraftPrompt(input: DraftInput): string {
  const shows = new Map((input.checklist ?? []).map((v) => [v.requirement, v.verdict]));
  const requirements = input.requirements
    .map((r) => {
      const verdict = shows.get(r.text);
      const status = verdict === 'met' ? 'resume shows it' : verdict === 'missing' ? 'NOT on the resume' : 'not checked';
      return `- ${r.text} (${r.kind === 'must' ? 'required' : 'nice to have'}; ${status})`;
    })
    .join('\n');
  return [
    `Write a ${input.kind.replace('_', ' ')} (${input.length}, ${input.tone}).`,
    `Candidate's name: ${input.candidateName}`,
    input.contactName ? `Addressed to: ${input.contactName}` : 'Addressed to: the hiring team (no contact name known)',
    `<job>\nCompany: ${input.company}\nRole: ${input.role}\nRequirements:\n${requirements || '(none listed)'}`,
    input.jobDescription ? `Job description:\n${input.jobDescription.slice(0, 6000)}` : '',
    '</job>',
    `<resume>\n${resumeLines(input.parsed)}\n</resume>`,
    `<notes>\n${input.notes?.slice(0, 2000) || '(none)'}\n</notes>`,
    input.avoid?.length
      ? `An earlier version made these claims, which the resume does not support. Do not make them again:\n${input.avoid.map((c) => `- ${c}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function streamDraft(
  input: DraftInput,
  { userId, signal }: { userId: string | null; signal?: AbortSignal },
  onText: (text: string) => void,
) {
  const prompt = buildDraftPrompt(input);
  return runStream(
    { feature: 'draft', promptVersion: DRAFT_PROMPT_VERSION, system: loadPrompt(DRAFT_PROMPT_VERSION), prompt, userId, recordingInput: { prompt }, signal },
    onText,
  );
}

// --- Claim check ---------------------------------------------------------------------

export const claimsSchema = z.object({
  claims: z.array(z.object({ text: z.string(), supported_by: z.array(z.string()) })),
});

export interface Claim {
  text: string;
  supported: boolean;
  evidence: { bulletId: string; text: string }[];
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

// Numbers like 86%, 4,000, 1.2 or 150, without commas. Years (1990-2039) are
// skipped: dates are rarely invented and appear in many forms.
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(\.\d+)?/g) ?? [])
    .map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''))
    .filter((n) => !/^(19[9]\d|20[0-3]\d)$/.test(n));
}

// Numbers in the draft that appear in none of the sources.
export function unsupportedNumbers(draft: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap(numbersIn));
  return [...new Set(numbersIn(draft).filter((n) => !known.has(n)))];
}

// The deterministic part of the model check, exported for tests: a claim must be
// in the draft word for word, and it is supported only by resume lines that exist.
export function verifyClaims(raw: z.infer<typeof claimsSchema>, draft: string, parsed: Pick<ParsedResume, 'sections'>): Claim[] {
  const bullets = new Map(allBullets(parsed).map((b) => [b.id, b]));
  const text = squash(draft);
  const seen = new Set<string>();
  return raw.claims
    .map((c) => ({ ...c, text: c.text.trim() }))
    .filter((c) => c.text.length >= 8 && text.includes(squash(c.text)) && !seen.has(squash(c.text)) && seen.add(squash(c.text)))
    .map((c) => {
      const evidence = [...new Set(c.supported_by.map((id) => id.trim().toLowerCase()))]
        .map((id) => bullets.get(id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b))
        .slice(0, 2)
        .map((b) => ({ bulletId: b.id, text: b.text }));
      return { text: c.text, supported: evidence.length > 0, evidence };
    });
}

export async function checkDraft(
  draft: string,
  parsed: Pick<ParsedResume, 'sections'>,
  otherSources: (string | null)[],
  { userId, useCache = true }: { userId: string | null; useCache?: boolean },
) {
  const lines = resumeLines(parsed);
  const prompt = `<message>\n${draft}\n</message>\n\n<resume>\n${lines}\n</resume>`;
  const result = await runStructured({
    feature: 'claim_check',
    promptVersion: CLAIMS_PROMPT_VERSION,
    system: loadPrompt(CLAIMS_PROMPT_VERSION),
    prompt,
    schema: claimsSchema,
    userId,
    cacheInput: { prompt },
    useCache,
    temperature: 0,
  });
  const claims = verifyClaims(result.data, draft, parsed);
  const numberFlags = unsupportedNumbers(draft, [allBullets(parsed).map((b) => b.text).join('\n'), ...otherSources.filter((s): s is string => Boolean(s))]);
  return { claims, numberFlags, model: result.model, promptVersion: result.promptVersion };
}
