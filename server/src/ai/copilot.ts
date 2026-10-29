import { isStepCount, streamText, tool } from 'ai';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { APP_COLUMNS, STATUSES } from '../routes/applications.js';
import { hybridSearch } from '../services/search.js';
import { steppedModel } from './recorder.js';
import { aiConfigured } from './provider.js';
import { checkQuota, loadPrompt, logCall, modelFailure } from './run.js';

// The copilot: a chat that answers questions about the user's applications by
// calling read tools, and prepares changes as proposals the user must confirm.
//
// Rules enforced in code, not left to the prompt:
//   - the user id comes from the session, never from tool arguments;
//   - every id is checked for ownership, every input is validated;
//   - write tools only create pending_actions rows; nothing changes until the
//     user confirms the card (routes/copilot.ts);
//   - write tools are offered only when the user's own message asks for a change,
//     so instructions hidden in a job description can't trigger one on a question.

export const COPILOT_PROMPT_VERSION = 'copilot.v1';
export const MAX_STEPS = 6;
const HISTORY_MESSAGES = 12; // earlier messages sent with each turn

const READ_TOOLS = ['search_applications', 'get_application', 'get_dashboard_stats', 'list_follow_ups', 'get_requirement_check', 'get_interview_progress'] as const;
const WRITE_TOOLS = ['propose_status_change', 'propose_follow_up', 'propose_application'] as const;
type ToolName = (typeof READ_TOOLS)[number] | (typeof WRITE_TOOLS)[number];

// Does the user's message ask for a change? Deliberately generous: it only decides
// whether the propose tools are offered at all; the model still decides, and the
// user still confirms.
const CHANGE_REQUEST = [
  /\b(move|mark|set|change|update|switch|put|add|create|save|track|log|record|remind|schedule|withdraw|reject|accept)\b/i,
  /\bfollow[- ]?up (on|with)\b/i,
  /\b(got|received|have|had|landed) (an? |the )?(offer|interview|rejection|call ?back)\b/i,
  /\bI (just )?(applied|withdrew|accepted|declined)\b/i,
  /\b(was|been|got) (rejected|accepted|shortlisted|ghosted)\b/i,
];
export const asksForChange = (message: string) => CHANGE_REQUEST.some((re) => re.test(message));

export interface ProposedAction {
  id: string;
  kind: 'status_change' | 'follow_up' | 'create_application';
  applicationId: string | null;
  summary: string;
  status: 'pending';
  expiresAt: string;
}

export type CopilotEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: ToolName }
  | { type: 'action'; action: ProposedAction };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// What tools return for an application: no internal fields, no timestamps.
const brief = (a: Record<string, unknown>) => ({
  id: a.id, company: a.company_name, role: a.role, status: a.status, type: a.type, priority: a.priority,
  location: a.location, salary: a.salary, applied_on: a.application_date, deadline: a.deadline, follow_up_date: a.follow_up_date,
});

interface Context {
  userId: string;
  quotaUserId: string | null; // whose daily AI allowance tool calls use (null in evals)
  today: string; // YYYY-MM-DD, India time
  onAction: (action: ProposedAction) => void;
}

function buildTools(ctx: Context) {
  const { userId } = ctx;
  const proposed = new Set<string>();

  const owned = async (id: string) => {
    if (!UUID.test(id)) return null;
    const r = await pool.query(`SELECT ${APP_COLUMNS} FROM applications WHERE id = $1 AND user_id = $2`, [id, userId]);
    return r.rows[0] ?? null;
  };

  async function propose(kind: ProposedAction['kind'], applicationId: string | null, payload: object, summary: string) {
    const dedupeKey = JSON.stringify([kind, applicationId, payload]);
    if (proposed.has(dedupeKey)) return { error: 'This change was already proposed in this reply.' };
    proposed.add(dedupeKey);
    const row = await pool.query<{ id: string; expires_at: Date }>(
      'INSERT INTO pending_actions (user_id, kind, application_id, payload, summary) VALUES ($1, $2, $3, $4, $5) RETURNING id, expires_at',
      [userId, kind, applicationId, JSON.stringify(payload), summary],
    );
    ctx.onAction({ id: row.rows[0].id, kind, applicationId, summary, status: 'pending', expiresAt: row.rows[0].expires_at.toISOString() });
    // The id stays out of the model's view: it has nothing to do with it.
    return { proposed: summary, note: 'Shown to the user as a card. Nothing has changed until they confirm it.' };
  }

  return {
    search_applications: tool({
      description: "Find the user's applications by company, role, skill or topic (matches words and meaning in job descriptions and notes). Leave query empty to list applications, optionally only one status.",
      inputSchema: z.object({
        query: z.string().optional().describe('What to look for, e.g. "Northwind", "Kafka", "remote internships". Empty to list all.'),
        status: z.enum(STATUSES).optional(),
      }),
      execute: async ({ query, status }) => {
        const q = query?.trim() ?? '';
        if (q.length >= 2) {
          const found = await hybridSearch(userId, q.slice(0, 200), 10, { quotaUserId: ctx.quotaUserId });
          const results = found.results.filter((a) => !status || a.status === status);
          return {
            matches: results.map((a) => ({ ...brief(a), matched_by: a.matchedBy, snippet: typeof a.snippet === 'string' ? a.snippet.replace(/\[\[|\]\]/g, '') : null })),
            note: results.length ? undefined : 'No application matches.',
          };
        }
        const rows = await pool.query(
          `SELECT ${APP_COLUMNS} FROM applications WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
           ORDER BY updated_at DESC, id LIMIT 30`,
          [userId, status ?? null],
        );
        return { count: rows.rowCount, applications: rows.rows.map(brief) };
      },
    }),

    get_application: tool({
      description: 'Full details of one application: contact, notes, job description, extracted requirements and recent status changes.',
      inputSchema: z.object({ id: z.string().describe('Application id from search_applications') }),
      execute: async ({ id }) => {
        const app = await owned(id);
        if (!app) return { error: 'No application with that id. Use search_applications to find it.' };
        const history = await pool.query(
          `SELECT from_status, to_status, note, changed_at::date::text AS date FROM status_history
           WHERE application_id = $1 ORDER BY changed_at DESC, id DESC LIMIT 5`,
          [id],
        );
        return {
          ...brief(app),
          url: app.url,
          contact: app.contact_name ? { name: app.contact_name, email: app.contact_email } : null,
          notes: app.notes,
          job_description: app.job_description ? String(app.job_description).slice(0, 2500) : null,
          requirements: app.jd_extraction?.requirements?.map((r: { text: string; kind: string }) => `${r.text} (${r.kind === 'must' ? 'required' : 'nice to have'})`) ?? [],
          recent_status_changes: history.rows,
        };
      },
    }),

    get_dashboard_stats: tool({
      description: 'Counts of applications by status, response rate and rejection rate.',
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await pool.query<{ status: string; n: number }>(
          'SELECT status, COUNT(*)::int AS n FROM applications WHERE user_id = $1 GROUP BY status ORDER BY status',
          [userId],
        );
        const by = Object.fromEntries(rows.rows.map((r) => [r.status, r.n]));
        const total = rows.rows.reduce((s, r) => s + r.n, 0);
        const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
        return {
          total,
          by_status: by,
          response_rate_percent: pct((by.interview ?? 0) + (by.offer ?? 0) + (by.accepted ?? 0)),
          rejection_rate_percent: pct(by.rejected ?? 0),
        };
      },
    }),

    list_follow_ups: tool({
      description: 'Follow-up dates and deadlines between two dates (default: today and the next 7 days), plus follow-ups already overdue.',
      inputSchema: z.object({
        from: z.string().optional().describe('YYYY-MM-DD'),
        to: z.string().optional().describe('YYYY-MM-DD'),
      }),
      execute: async ({ from, to }) => {
        const start = from && ISO_DATE.test(from) ? from : ctx.today;
        const end = to && ISO_DATE.test(to) ? to : addDays(start, 7);
        const rows = await pool.query(
          `SELECT ${APP_COLUMNS} FROM applications WHERE user_id = $1
             AND (follow_up_date BETWEEN $2 AND $3 OR deadline BETWEEN $2 AND $3)
           ORDER BY LEAST(follow_up_date, deadline), company_name`,
          [userId, start, end],
        );
        const overdue = await pool.query(
          `SELECT ${APP_COLUMNS} FROM applications WHERE user_id = $1 AND follow_up_date < $2
             AND status IN ('wishlist', 'applied', 'interview', 'offer') ORDER BY follow_up_date, company_name`,
          [userId, ctx.today],
        );
        return { from: start, to: end, upcoming: rows.rows.map(brief), overdue_follow_ups: overdue.rows.map(brief) };
      },
    }),

    get_requirement_check: tool({
      description: "The latest check of the job's requirements against the user's resume: which are shown on the resume and which are missing.",
      inputSchema: z.object({ application_id: z.string() }),
      execute: async ({ application_id }) => {
        if (!(await owned(application_id))) return { error: 'No application with that id. Use search_applications to find it.' };
        const check = await pool.query<{ verdicts: { requirement: string; kind: string; verdict: string }[]; date: string }>(
          'SELECT verdicts, created_at::date::text AS date FROM requirement_checks WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
          [application_id],
        );
        if (!check.rows[0]) return { note: 'No requirements check yet. The user can run one on the application page.' };
        const of = (verdict: string) => check.rows[0].verdicts.filter((v) => v.verdict === verdict).map((v) => `${v.requirement}${v.kind === 'must' ? ' (required)' : ''}`);
        return { checked_on: check.rows[0].date, on_resume: of('met'), missing: of('missing'), unclear: of('unverified') };
      },
    }),

    get_interview_progress: tool({
      description: 'Results of completed mock interviews (average scores per criterion and what to improve), for one application or all.',
      inputSchema: z.object({ application_id: z.string().optional() }),
      execute: async ({ application_id }) => {
        if (application_id && !(await owned(application_id))) return { error: 'No application with that id. Use search_applications to find it.' };
        const rows = await pool.query(
          `SELECT a.company_name AS company, a.role, s.completed_at::date::text AS date,
                  s.summary -> 'averages' AS averages, s.summary -> 'improvements' AS improvements
           FROM interview_sessions s JOIN applications a ON a.id = s.application_id
           WHERE s.user_id = $1 AND s.status = 'completed' AND ($2::uuid IS NULL OR s.application_id = $2)
           ORDER BY s.completed_at DESC LIMIT 5`,
          [userId, application_id ?? null],
        );
        if (!rows.rows.length) return { note: 'No completed mock interviews yet.' };
        return {
          interviews: rows.rows.map((r) => ({
            ...r,
            improvements: (r.improvements ?? []).slice(0, 3).map((i: { text: string }) => i.text),
            scale: 'scores are 1 to 4',
          })),
        };
      },
    }),

    propose_status_change: tool({
      description: "Prepare a status change for one application. The user must confirm it; nothing changes before that.",
      inputSchema: z.object({
        application_id: z.string(),
        status: z.enum(STATUSES),
        note: z.string().optional().describe('Short note for the status history, from the user\'s words'),
      }),
      execute: async ({ application_id, status, note }) => {
        const app = await owned(application_id);
        if (!app) return { error: 'No application with that id. Use search_applications to find it.' };
        if (app.status === status) return { error: `${app.company_name} is already "${status}".` };
        const cleanNote = note?.trim().slice(0, 300) || null;
        return propose('status_change', application_id, { status, note: cleanNote },
          `Move ${app.company_name} – ${app.role} from ${app.status} to ${status}${cleanNote ? ` (note: ${cleanNote})` : ''}`);
      },
    }),

    propose_follow_up: tool({
      description: 'Prepare a follow-up reminder date for one application. The user must confirm it.',
      inputSchema: z.object({ application_id: z.string(), date: z.string().describe('YYYY-MM-DD') }),
      execute: async ({ application_id, date }) => {
        const app = await owned(application_id);
        if (!app) return { error: 'No application with that id. Use search_applications to find it.' };
        if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) return { error: 'The date must be YYYY-MM-DD.' };
        if (date < ctx.today) return { error: `${date} is in the past (today is ${ctx.today}).` };
        if (date > addDays(ctx.today, 366)) return { error: 'Follow-ups can be at most a year ahead.' };
        return propose('follow_up', application_id, { date }, `Set a follow-up for ${app.company_name} – ${app.role} on ${date}`);
      },
    }),

    propose_application: tool({
      description: 'Prepare a new application to track. The user must confirm it.',
      inputSchema: z.object({
        company_name: z.string(),
        role: z.string(),
        status: z.enum(['wishlist', 'applied']).optional().describe('"applied" only if the user says they applied; otherwise wishlist'),
        location: z.string().optional(),
        url: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async ({ company_name, role, status, location, url, notes }) => {
        const company = company_name.trim().slice(0, 255);
        const title = role.trim().slice(0, 255);
        if (!company || !title) return { error: 'A company name and a role are needed.' };
        const existing = await pool.query(
          'SELECT id FROM applications WHERE user_id = $1 AND lower(company_name) = lower($2) AND lower(role) = lower($3)',
          [userId, company, title],
        );
        if (existing.rows[0]) return { error: `${company} – ${title} is already tracked (id ${existing.rows[0].id}).` };
        const fields = {
          company_name: company, role: title, status: status ?? 'wishlist',
          location: location?.trim().slice(0, 255) || null,
          url: url && /^https?:\/\/\S+$/i.test(url.trim()) ? url.trim().slice(0, 500) : null,
          notes: notes?.trim().slice(0, 2000) || null,
        };
        return propose('create_application', null, fields, `Add ${company} – ${title} (${fields.status})${fields.location ? `, ${fields.location}` : ''}`);
      },
    }),
  };
}

export interface CopilotTurn {
  userId: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  today: string;
  onEvent: (event: CopilotEvent) => void;
  signal?: AbortSignal;
  // Evals turn the gate off to measure what the model alone would do.
  changeGate?: boolean;
  quotaUserId?: string | null;
}

export async function runCopilot(turn: CopilotTurn) {
  const { userId, today, onEvent } = turn;
  const quotaUserId = turn.quotaUserId === undefined ? userId : turn.quotaUserId;
  if (!aiConfigured()) throw new AppError(503, 'AI_DISABLED', 'AI features are not set up on this server.');
  if (quotaUserId) await checkQuota(quotaUserId, 'copilot', COPILOT_PROMPT_VERSION);

  const actions: ProposedAction[] = [];
  const toolsUsed: { name: ToolName; input: unknown }[] = [];
  const tools = buildTools({ userId, quotaUserId, today, onAction: (a) => { actions.push(a); onEvent({ type: 'action', action: a }); } });
  const writesOffered = turn.changeGate === false || asksForChange(turn.message);
  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });

  let text = '';
  let stepStarted = Date.now();
  const started = Date.now();
  try {
    const result = streamText({
      model: steppedModel('copilot'),
      system: loadPrompt(COPILOT_PROMPT_VERSION).replace('{{TODAY}}', `${weekday} ${today}`),
      messages: [...turn.history.slice(-HISTORY_MESSAGES), { role: 'user', content: turn.message }],
      tools,
      activeTools: writesOffered ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS],
      stopWhen: isStepCount(MAX_STEPS),
      temperature: 0,
      maxRetries: 1,
      abortSignal: turn.signal ? AbortSignal.any([turn.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        text += part.text;
        onEvent({ type: 'text', text: part.text });
      } else if (part.type === 'tool-call') {
        toolsUsed.push({ name: part.toolName as ToolName, input: part.input });
        onEvent({ type: 'tool', name: part.toolName as ToolName });
      } else if (part.type === 'finish-step') {
        await logCall({
          userId: quotaUserId, feature: 'copilot', promptVersion: COPILOT_PROMPT_VERSION, status: 'ok',
          latencyMs: Date.now() - stepStarted, inputTokens: part.usage.inputTokens, outputTokens: part.usage.outputTokens,
        });
        stepStarted = Date.now();
      } else if (part.type === 'error') {
        throw part.error;
      }
    }
  } catch (err) {
    throw await modelFailure(err, { userId: quotaUserId, feature: 'copilot', promptVersion: COPILOT_PROMPT_VERSION, latencyMs: Date.now() - started });
  }

  if (!text.trim()) {
    // The step limit ran out while the model was still calling tools.
    text = actions.length
      ? 'I prepared the change below. It will happen once you confirm it.'
      : "I couldn't finish that within a few lookups. Try asking about one application at a time.";
    onEvent({ type: 'text', text });
  }
  return { text, actions, toolsUsed, writesOffered };
}
