import { z } from 'zod';
import { loadPrompt, runStructured } from './run.js';

// Resume text → sections of bullets, each with an id (b1, b2, …) that other
// features cite. The model only splits the text; code keeps a bullet only if
// its words appear in the resume exactly, so nothing reworded can be cited.

export const PROMPT_VERSION = 'resume_parse.v1';
export const MAX_RESUME_LENGTH = 15_000;

const SECTION_KINDS = ['experience', 'projects', 'skills', 'education', 'achievements', 'other'] as const;

// No .max() on these arrays: Gemini rejects nested size limits as "invalid argument",
// so the limits are applied in verifyBullets instead.
export const parseSchema = z.object({
  sections: z.array(
    z.object({
      kind: z.enum(SECTION_KINDS),
      title: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
});

const MAX_SECTIONS = 20;
const MAX_BULLETS_PER_SECTION = 60;

export interface Bullet {
  id: string;
  text: string;
}
export interface ParsedResume {
  sections: { kind: (typeof SECTION_KINDS)[number]; title: string; bullets: Bullet[] }[];
  dropped: number; // bullets left out because they weren't verbatim (or were contact details)
  model: string;
  promptVersion: string;
}

// Lower case, no bullet symbols and no whitespace at all: PDFs wrap lines anywhere,
// even mid-word ("A\nWS"), so only the sequence of visible characters is compared.
export const normalizeForMatch = (text: string) =>
  text
    .toLowerCase()
    .replace(/[•▪●○◦■□►–—*]/g, '')
    .replace(/\s+/g, '');

// Emails, links and phone numbers (10 digits, or a country code + 10). Date ranges
// like "2023 – 2025" must not match.
const CONTACT = /@|https?:\/\/|www\.|linkedin\.com|github\.com|\b\d{10}\b|\+\d{1,3}[\s-]?\d{3,5}[\s-]?\d{3,5}[\s-]?\d{0,4}/i;

// The deterministic part, exported for tests.
export function verifyBullets(raw: z.infer<typeof parseSchema>, resumeText: string) {
  const haystack = normalizeForMatch(resumeText);
  let next = 1;
  let dropped = 0;
  const sections = raw.sections
    .slice(0, MAX_SECTIONS)
    .map((section) => ({
      kind: section.kind,
      title: section.title.trim().slice(0, 80) || 'Other',
      bullets: section.bullets.slice(0, MAX_BULLETS_PER_SECTION).flatMap((text) => {
        const clean = text.replace(/^[\s•▪●○◦■□►*-]+/, '').trim();
        const normalized = normalizeForMatch(clean);
        // Too short to be useful, not in the resume word for word, or contact details.
        if (normalized.length < 3 || !haystack.includes(normalized) || CONTACT.test(clean)) {
          if (normalized.length >= 3) dropped += 1;
          return [];
        }
        return [{ id: `b${next++}`, text: clean }];
      }),
    }))
    .filter((section) => section.bullets.length > 0);
  return { sections, dropped };
}

export async function parseResume(
  resumeText: string,
  userId: string | null,
  { useCache = true }: { useCache?: boolean } = {},
): Promise<ParsedResume> {
  const result = await runStructured({
    feature: 'resume_parse',
    promptVersion: PROMPT_VERSION,
    system: loadPrompt(PROMPT_VERSION),
    prompt: `<resume>\n${resumeText}\n</resume>`,
    schema: parseSchema,
    userId,
    cacheInput: { resumeText },
    useCache,
  });
  const { sections, dropped } = verifyBullets(result.data, resumeText);
  return { sections, dropped, model: result.model, promptVersion: result.promptVersion };
}

export const allBullets = (parsed: Pick<ParsedResume, 'sections'>): Bullet[] => parsed.sections.flatMap((s) => s.bullets);
