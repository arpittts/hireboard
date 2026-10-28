import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth, userIdOf } from '../middleware/auth.js';
import { AppError, notFound } from '../middleware/errors.js';
import { generateQuestionBank, missingMustRequirements, type Question } from '../ai/questionBank.js';
import { chooseQuestions, CLOSING, decideNext, isSkip, MAX_ANSWER_LENGTH, OPENING } from '../ai/interviewer.js';
import { gradeAnswer, summarize, type GradedAnswer } from '../ai/feedback.js';
import { loadPrompt } from '../ai/run.js';
import type { CheckedRequirement } from '../ai/requirementsCheck.js';

// Question bank (per application) and mock interviews.
//   /api/applications/:id/questions    GET latest bank, POST generate, PUT save edits
//   /api/applications/:id/interviews   GET past sessions, POST start a session
//   /api/interviews/:id                GET transcript; POST /answer; POST /end; POST /feedback
//   /api/interviews/rubric             GET the rubric used for feedback

const appParams = z.object({ id: z.uuid('Invalid application id.') });
const sessionParams = z.object({ id: z.uuid('Invalid interview id.') });

const editSchema = z.object({
  questions: z
    .array(z.object({ id: z.string().max(20).optional(), text: z.string().trim().min(10, 'Questions need at least a few words.').max(400) }))
    .min(1, 'Keep at least one question.')
    .max(20),
});
const answerSchema = z.object({
  answer: z.string().trim().min(1, 'Type an answer, or skip the question.').max(MAX_ANSWER_LENGTH),
});

async function ownedApplication(id: string, userId: string) {
  const result = await pool.query(
    'SELECT id, company_name, role, notes, job_description, jd_extraction FROM applications WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (!result.rows[0]) throw notFound('Application');
  return result.rows[0];
}

async function latestBank(applicationId: string) {
  const result = await pool.query(
    'SELECT id, questions, model, prompt_version, created_at FROM question_banks WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
    [applicationId],
  );
  return result.rows[0] ?? null;
}

async function latestChecklist(applicationId: string): Promise<CheckedRequirement[] | null> {
  const result = await pool.query(
    'SELECT verdicts FROM requirement_checks WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1',
    [applicationId],
  );
  return result.rows[0]?.verdicts ?? null;
}

async function loadSession(id: string, userId: string) {
  const session = await pool.query(
    `SELECT s.*, a.company_name, a.role FROM interview_sessions s JOIN applications a ON a.id = s.application_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId],
  );
  if (!session.rows[0]) throw notFound('Interview');
  const turns = await pool.query(
    'SELECT question_index, speaker, kind, content, created_at FROM interview_turns WHERE session_id = $1 ORDER BY id',
    [id],
  );
  const feedback = await pool.query(
    'SELECT question_index, scores, improvement, removed_instructions, model, prompt_version FROM answer_feedback WHERE session_id = $1 ORDER BY question_index',
    [id],
  );
  return { ...session.rows[0], opening: OPENING, turns: turns.rows, feedback: feedback.rows };
}

// --- Question bank ---------------------------------------------------------------

export const questionsRouter = Router();
questionsRouter.use(requireAuth);

questionsRouter.get('/:id/questions', async (req, res) => {
  const { id } = appParams.parse(req.params);
  await ownedApplication(id, userIdOf(req));
  res.json(await latestBank(id));
});

questionsRouter.post('/:id/questions', async (req, res) => {
  const { id } = appParams.parse(req.params);
  const userId = userIdOf(req);
  const app = await ownedApplication(id, userId);
  const requirements = app.jd_extraction?.requirements ?? [];
  if (requirements.length === 0) {
    throw new AppError(400, 'NO_JOB_DESCRIPTION', 'Add the job description first, so the questions fit this role (Edit → Job description).');
  }
  const resume = await pool.query('SELECT parsed FROM resumes WHERE user_id = $1 AND is_active', [userId]);
  const result = await generateQuestionBank(
    {
      company: app.company_name,
      role: app.role,
      jobDescription: app.job_description,
      notes: app.notes,
      requirements,
      parsed: resume.rows[0]?.parsed ?? null,
      checklist: await latestChecklist(id),
    },
    { userId },
  );
  const saved = await pool.query(
    `INSERT INTO question_banks (application_id, questions, model, prompt_version) VALUES ($1, $2, $3, $4)
     RETURNING id, questions, model, prompt_version, created_at`,
    [id, JSON.stringify(result.questions), result.model, result.promptVersion],
  );
  res.status(201).json(saved.rows[0]);
});

// Save the user's edits: reorder, delete, reword or add questions. Known ids keep
// their details; new questions become "custom".
questionsRouter.put('/:id/questions', async (req, res) => {
  const { id } = appParams.parse(req.params);
  await ownedApplication(id, userIdOf(req));
  const { questions } = editSchema.parse(req.body);
  const previous = new Map<string, Question>(((await latestBank(id))?.questions ?? []).map((q: Question) => [q.id, q]));
  const edited: Question[] = questions.map((q, i) => {
    const old = q.id ? previous.get(q.id) : undefined;
    const base = old ?? { kind: 'custom' as const, requirement: null, whyAsked: 'Your own question.', resumeLine: null };
    return { ...base, id: `q${i + 1}`, text: q.text };
  });
  const saved = await pool.query(
    `INSERT INTO question_banks (application_id, questions) VALUES ($1, $2) RETURNING id, questions, model, prompt_version, created_at`,
    [id, JSON.stringify(edited)],
  );
  res.json(saved.rows[0]);
});

// --- Starting and listing interviews ------------------------------------------------

questionsRouter.get('/:id/interviews', async (req, res) => {
  const { id } = appParams.parse(req.params);
  await ownedApplication(id, userIdOf(req));
  const sessions = await pool.query(
    `SELECT s.id, s.status, s.created_at, s.completed_at, jsonb_array_length(s.questions) AS question_count,
            s.summary -> 'averages' AS averages,
            (SELECT COUNT(DISTINCT t.question_index)::int FROM interview_turns t WHERE t.session_id = s.id AND t.speaker = 'candidate') AS answers
     FROM interview_sessions s WHERE s.application_id = $1 ORDER BY s.created_at DESC`,
    [id],
  );
  res.json(sessions.rows);
});

questionsRouter.post('/:id/interviews', async (req, res) => {
  const { id } = appParams.parse(req.params);
  const userId = userIdOf(req);
  await ownedApplication(id, userId);

  // Carry on with an unfinished interview instead of starting a second one.
  const active = await pool.query("SELECT id FROM interview_sessions WHERE application_id = $1 AND status = 'active'", [id]);
  if (active.rows[0]) {
    res.json(await loadSession(active.rows[0].id, userId));
    return;
  }
  const bank = await latestBank(id);
  if (!bank || bank.questions.length === 0) {
    throw new AppError(400, 'NO_QUESTIONS', 'Generate the question bank first.');
  }
  const questions = chooseQuestions(bank.questions, missingMustRequirements(await latestChecklist(id)));
  const sessionId = await withTransaction(async (client) => {
    const created = await client.query(
      'INSERT INTO interview_sessions (user_id, application_id, questions) VALUES ($1, $2, $3) RETURNING id',
      [userId, id, JSON.stringify(questions)],
    );
    await client.query(
      "INSERT INTO interview_turns (session_id, question_index, speaker, kind, content) VALUES ($1, 0, 'interviewer', 'question', $2)",
      [created.rows[0].id, questions[0].text],
    );
    return created.rows[0].id;
  });
  res.status(201).json(await loadSession(sessionId, userId));
});

// --- During an interview --------------------------------------------------------------

export const interviewsRouter = Router();
interviewsRouter.use(requireAuth);

// Declared before /:id so "rubric" isn't read as an interview id.
interviewsRouter.get('/rubric', (_req, res) => {
  res.json({ version: 'rubric.v1', markdown: loadPrompt('rubric.v1') });
});

interviewsRouter.get('/:id', async (req, res) => {
  const { id } = sessionParams.parse(req.params);
  res.json(await loadSession(id, userIdOf(req)));
});

interviewsRouter.post('/:id/answer', async (req, res) => {
  const { id } = sessionParams.parse(req.params);
  const userId = userIdOf(req);
  const { answer } = answerSchema.parse(req.body);

  // 1. Save the answer, but only if the interviewer is waiting for one.
  const state = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT s.*, a.company_name, a.role FROM interview_sessions s JOIN applications a ON a.id = s.application_id
       WHERE s.id = $1 AND s.user_id = $2 FOR UPDATE OF s`,
      [id, userId],
    );
    const session = result.rows[0];
    if (!session) throw notFound('Interview');
    if (session.status !== 'active') throw new AppError(409, 'INTERVIEW_OVER', 'This interview has ended.');
    const last = await client.query('SELECT speaker FROM interview_turns WHERE session_id = $1 ORDER BY id DESC LIMIT 1', [id]);
    if (last.rows[0]?.speaker !== 'interviewer') {
      throw new AppError(409, 'NOT_YOUR_TURN', 'Wait for the interviewer before answering again.');
    }
    await client.query(
      "INSERT INTO interview_turns (session_id, question_index, speaker, kind, content) VALUES ($1, $2, 'candidate', 'answer', $3)",
      [id, session.current_index, answer],
    );
    return session;
  });

  // 2. Decide what happens next (outside the transaction: the model can take seconds).
  const questions: Question[] = state.questions;
  const decision = await decideNext(
    { company: state.company_name, role: state.role, question: questions[state.current_index], answer, followUpUsed: state.follow_up_used },
    { userId },
  );

  // 3. Apply it. The state is re-checked so a double submit can't advance twice.
  await withTransaction(async (client) => {
    const fresh = await client.query('SELECT current_index, follow_up_used, status FROM interview_sessions WHERE id = $1 FOR UPDATE', [id]);
    const now = fresh.rows[0];
    if (now.status !== 'active' || now.current_index !== state.current_index || now.follow_up_used !== state.follow_up_used) return;

    const say = (index: number, kind: string, content: string) =>
      client.query("INSERT INTO interview_turns (session_id, question_index, speaker, kind, content) VALUES ($1, $2, 'interviewer', $3, $4)", [id, index, kind, content]);

    if (decision.action === 'follow_up' && decision.followUp) {
      await client.query('UPDATE interview_sessions SET follow_up_used = TRUE WHERE id = $1', [id]);
      await say(state.current_index, 'follow_up', decision.followUp);
      return;
    }
    const next = state.current_index + 1;
    if (next >= questions.length) {
      await client.query("UPDATE interview_sessions SET current_index = $2, follow_up_used = FALSE, status = 'completed', completed_at = now() WHERE id = $1", [id, next]);
      await say(state.current_index, 'closing', CLOSING);
    } else {
      await client.query('UPDATE interview_sessions SET current_index = $2, follow_up_used = FALSE WHERE id = $1', [id, next]);
      await say(next, 'question', questions[next].text);
    }
  });
  res.json(await loadSession(id, userId));
});

// Stop early. Answered questions are kept (feedback can still use them).
interviewsRouter.post('/:id/end', async (req, res) => {
  const { id } = sessionParams.parse(req.params);
  const userId = userIdOf(req);
  await loadSession(id, userId);
  await pool.query(
    "UPDATE interview_sessions SET status = 'abandoned', completed_at = now() WHERE id = $1 AND status = 'active'",
    [id],
  );
  res.json(await loadSession(id, userId));
});

// Feedback on every answered question of a finished interview. Questions that
// already have feedback are skipped, so a failed run can simply be retried.
interviewsRouter.post('/:id/feedback', async (req, res) => {
  const { id } = sessionParams.parse(req.params);
  const userId = userIdOf(req);
  const session = await loadSession(id, userId);
  if (session.status === 'active') throw new AppError(409, 'INTERVIEW_ACTIVE', 'Finish or end the interview first.');

  const questions: Question[] = session.questions;
  type Turn = { question_index: number; speaker: string; kind: string; content: string };
  const turnsFor = (i: number) => (session.turns as Turn[]).filter((t) => t.question_index === i);
  const done = new Set((session.feedback as { question_index: number }[]).map((f) => f.question_index));

  const toGrade: { index: number; answer: string; followUp: string | null; followUpAnswer: string | null }[] = [];
  const skipped: Question[] = [];
  const skippedIndexes: number[] = [];
  questions.forEach((question, index) => {
    const turns = turnsFor(index);
    const answers = turns.filter((t) => t.speaker === 'candidate').map((t) => t.content);
    if (answers.length === 0) return; // never reached
    if (isSkip(answers[0])) {
      skipped.push(question);
      skippedIndexes.push(index);
      return;
    }
    if (done.has(index)) return;
    const followUp = turns.find((t) => t.kind === 'follow_up')?.content ?? null;
    toGrade.push({ index, answer: answers[0], followUp, followUpAnswer: followUp ? answers[1] ?? null : null });
  });

  // Up to five answers, graded at the same time.
  const results = await Promise.allSettled(
    toGrade.map((item) =>
      gradeAnswer(
        { company: session.company_name, role: session.role, question: questions[item.index], answer: item.answer, followUp: item.followUp, followUpAnswer: item.followUpAnswer },
        { userId },
      ).then((graded) => ({ item, graded })),
    ),
  );
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { item, graded } = result.value;
    await pool.query(
      `INSERT INTO answer_feedback (session_id, question_index, scores, improvement, removed_instructions, model, prompt_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (session_id, question_index) DO NOTHING`,
      [id, item.index, JSON.stringify(graded.scores), graded.improvement, JSON.stringify(graded.removedInstructions), graded.model, graded.promptVersion],
    );
  }

  const rows = await pool.query('SELECT question_index, scores, improvement FROM answer_feedback WHERE session_id = $1', [id]);
  const graded: GradedAnswer[] = rows.rows.map((r) => ({ questionIndex: r.question_index, question: questions[r.question_index], scores: r.scores, improvement: r.improvement }));
  const summary = { ...summarize(graded, skipped), skippedIndexes };
  await pool.query('UPDATE interview_sessions SET summary = $2 WHERE id = $1', [id, JSON.stringify(summary)]);

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0 && graded.length === 0) throw (failed[0] as PromiseRejectedResult).reason;
  res.json({ ...(await loadSession(id, userId)), feedbackFailed: failed.length });
});
