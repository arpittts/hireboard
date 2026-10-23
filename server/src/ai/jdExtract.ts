import { z } from 'zod';
import { loadPrompt, runStructured } from './run.js';

// Job description → the fields of an application, plus the requirements list.
// The model fills the schema; code then checks what the model can get wrong
// (made-up links, impossible salaries, old dates, a company not in the text).

export const PROMPT_VERSION = 'jd_extract.v1';
export const MAX_JD_LENGTH = 20_000;

const confidence = z.enum(['high', 'medium', 'low']);

export const jdSchema = z.object({
  company_name: z.string().nullable(),
  role: z.string().nullable(),
  location: z.string().nullable(),
  work_mode: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
  type: z.enum(['job', 'internship', 'freelance', 'contract']).nullable(),
  salary: z.object({
    raw: z.string().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    currency: z.string().nullable(),
    period: z.enum(['year', 'month', 'week', 'day', 'hour', 'project']).nullable(),
  }),
  deadline: z.string().nullable(),
  url: z.string().nullable(),
  requirements: z
    .array(z.object({ text: z.string(), kind: z.enum(['must', 'nice']), skills: z.array(z.string()) }))
    .max(20),
  confidence: z.object({
    company_name: confidence,
    role: confidence,
    location: confidence,
    type: confidence,
    salary: confidence,
    deadline: confidence,
  }),
});

export type JdExtraction = z.infer<typeof jdSchema>;
export type ConfidenceField = keyof JdExtraction['confidence'];

// What the client gets: the form fields, ready to drop into the application form.
export interface JdResult {
  fields: {
    company_name: string | null;
    role: string | null;
    location: string | null;
    type: JdExtraction['type'];
    salary: string | null;
    deadline: string | null;
    url: string | null;
  };
  extraction: JdExtraction; // after the checks below
  warnings: string[];
  cached: boolean;
  model: string;
  promptVersion: string;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const isRealDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// The deterministic checks. Exported so tests can run them without a model.
export function checkExtraction(raw: JdExtraction, jdText: string, today: string) {
  const data: JdExtraction = structuredClone(raw);
  const warnings: string[] = [];
  const text = normalize(jdText);
  const lower = jdText.toLowerCase();

  // A company the posting never mentions is probably invented.
  if (data.company_name && !text.includes(normalize(data.company_name))) {
    data.confidence.company_name = 'low';
    warnings.push(`"${data.company_name}" doesn't appear in the posting. Check the company name.`);
  }

  if (data.deadline) {
    if (!isRealDate(data.deadline)) {
      warnings.push(`Ignored an invalid deadline (${data.deadline}).`);
      data.deadline = null;
      data.confidence.deadline = 'low';
    } else if (daysBetween(data.deadline, today) > 365) {
      warnings.push(`Ignored a deadline more than a year ago (${data.deadline}).`);
      data.deadline = null;
      data.confidence.deadline = 'low';
    } else if (data.deadline < today) {
      warnings.push(`The deadline (${data.deadline}) has already passed.`);
    }
  }

  const { min, max } = data.salary;
  if ((min !== null && min < 0) || (max !== null && max < 0) || (min !== null && max !== null && min > max)) {
    warnings.push('The salary range looked wrong, so only the original text is kept.');
    data.salary = { ...data.salary, min: null, max: null };
    data.confidence.salary = 'low';
  }

  // Links must be real http(s) URLs that are written in the posting.
  if (data.url) {
    const looksLikeUrl = /^https?:\/\/\S+$/i.test(data.url);
    if (!looksLikeUrl || !lower.includes(data.url.toLowerCase().replace(/\/$/, ''))) {
      warnings.push('Ignored a link that is not in the posting.');
      data.url = null;
    }
  }

  // Drop empty or repeated requirements; keep at most 12.
  const seen = new Set<string>();
  data.requirements = data.requirements
    .map((r) => ({ ...r, text: r.text.trim(), skills: [...new Set(r.skills.map((s) => s.trim()).filter(Boolean))] }))
    .filter((r) => r.text && !seen.has(normalize(r.text)) && seen.add(normalize(r.text)))
    .slice(0, 12);

  return { data, warnings };
}

// "Bengaluru" + hybrid → "Bengaluru (hybrid)"; remote with no city → "Remote".
function formLocation(data: JdExtraction): string | null {
  if (!data.location) return data.work_mode === 'remote' ? 'Remote' : null;
  if (!data.work_mode || data.work_mode === 'onsite' || data.location.toLowerCase().includes(data.work_mode)) {
    return data.location;
  }
  return `${data.location} (${data.work_mode})`;
}

export async function extractJobDescription(
  jdText: string,
  { userId, today = new Date().toISOString().slice(0, 10), useCache = true }: { userId: string | null; today?: string; useCache?: boolean },
): Promise<JdResult> {
  const result = await runStructured({
    feature: 'jd_extract',
    promptVersion: PROMPT_VERSION,
    system: `${loadPrompt(PROMPT_VERSION)}\nToday's date: ${today}.`,
    prompt: `<job_description>\n${jdText}\n</job_description>`,
    schema: jdSchema,
    userId,
    cacheInput: { jdText, today },
    useCache,
  });

  const { data, warnings } = checkExtraction(result.data, jdText, today);
  return {
    fields: {
      company_name: data.company_name,
      role: data.role,
      location: formLocation(data),
      type: data.type,
      salary: data.salary.raw,
      deadline: data.deadline,
      url: data.url,
    },
    extraction: data,
    warnings,
    cached: result.cached,
    model: result.model,
    promptVersion: result.promptVersion,
  };
}
