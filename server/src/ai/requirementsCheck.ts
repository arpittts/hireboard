import { z } from 'zod';
import { loadPrompt, runStructured } from './run.js';
import { allBullets, type ParsedResume } from './resumeParse.js';

// Job requirements + resume bullets → met / missing per requirement.
// The model cites bullets only by id; code checks every id exists, so the
// evidence shown to the user is always a real line from their resume.
// There is deliberately no score: this is a checklist to prepare from, not a ranking.

export const PROMPT_VERSION = 'requirements_check.v1';

export interface Requirement {
  text: string;
  kind: 'must' | 'nice';
  skills: string[];
}

// No .max() on these arrays (Gemini rejects nested limits); verifyVerdicts keeps
// one verdict per requirement and at most two cited bullets.
export const checkSchema = z.object({
  verdicts: z.array(
    z.object({
      requirement_id: z.string(),
      verdict: z.enum(['met', 'missing']),
      bullet_ids: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});

export type Verdict = 'met' | 'missing' | 'unverified';

export interface CheckedRequirement {
  requirement: string;
  kind: 'must' | 'nice';
  verdict: Verdict;
  evidence: { bulletId: string; text: string }[];
  reason: string;
}

// The deterministic part, exported for tests: one verdict per requirement,
// every cited id must be a real bullet, and "met" needs at least one.
export function verifyVerdicts(
  raw: z.infer<typeof checkSchema>,
  requirements: Requirement[],
  parsed: Pick<ParsedResume, 'sections'>,
): CheckedRequirement[] {
  const bullets = new Map(allBullets(parsed).map((b) => [b.id, b]));
  const byId = new Map(raw.verdicts.map((v) => [v.requirement_id.trim().toLowerCase(), v]));

  return requirements.map((req, i) => {
    const answer = byId.get(`r${i + 1}`);
    if (!answer) {
      return { requirement: req.text, kind: req.kind, verdict: 'unverified', evidence: [], reason: 'The AI did not assess this requirement.' };
    }
    const evidence = [...new Set(answer.bullet_ids.map((id) => id.trim().toLowerCase()))]
      .map((id) => bullets.get(id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .slice(0, 2)
      .map((b) => ({ bulletId: b.id, text: b.text }));

    if (answer.verdict === 'met' && evidence.length === 0) {
      return {
        requirement: req.text, kind: req.kind, verdict: 'unverified', evidence: [],
        reason: 'The AI said this is met but cited no line from your resume, so it is not counted.',
      };
    }
    return {
      requirement: req.text,
      kind: req.kind,
      verdict: answer.verdict,
      evidence: answer.verdict === 'met' ? evidence : [],
      reason: answer.reason.trim().slice(0, 300),
    };
  });
}

export async function checkRequirements(
  requirements: Requirement[],
  parsed: Pick<ParsedResume, 'sections'>,
  { userId, useCache = true }: { userId: string | null; useCache?: boolean },
) {
  const requirementList = requirements
    .map((r, i) => `r${i + 1} (${r.kind === 'must' ? 'required' : 'nice to have'}): ${r.text}`)
    .join('\n');
  const resumeList = parsed.sections
    .map((s) => `## ${s.title}\n${s.bullets.map((b) => `${b.id}: ${b.text}`).join('\n')}`)
    .join('\n\n');

  const result = await runStructured({
    feature: 'requirements_check',
    promptVersion: PROMPT_VERSION,
    system: loadPrompt(PROMPT_VERSION),
    prompt: `Requirements:\n${requirementList}\n\n<resume>\n${resumeList}\n</resume>`,
    schema: checkSchema,
    userId,
    cacheInput: { requirementList, resumeList },
    useCache,
  });
  return {
    verdicts: verifyVerdicts(result.data, requirements, parsed),
    model: result.model,
    promptVersion: result.promptVersion,
  };
}
