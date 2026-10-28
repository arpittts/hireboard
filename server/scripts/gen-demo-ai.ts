// Generates src/services/demoAi.ts: the demo account's resume and requirement
// checks, made once with the live model and then frozen, so demo visitors see
// real AI output instantly without using any quota. Re-run after changing prompts:
//   npx tsx scripts/gen-demo-ai.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { parseResume } from '../src/ai/resumeParse.js';
import { checkRequirements, type Requirement } from '../src/ai/requirementsCheck.js';
import { generateQuestionBank, missingMustRequirements, type Question } from '../src/ai/questionBank.js';
import { chooseQuestions, CLOSING, decideNext, isSkip } from '../src/ai/interviewer.js';
import { gradeAnswer, summarize, type GradedAnswer } from '../src/ai/feedback.js';
import { checkDraft, streamDraft } from '../src/ai/drafts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'server/src/services/demoAi.ts');

const JOBS: { company: string; jobDescription: string; requirements: Requirement[] }[] = [
  {
    company: 'Northwind Analytics',
    jobDescription: `Northwind Analytics – AI Engineer Intern (LLM Applications), Bengaluru (hybrid)

Our GenAI team builds assistants for retail store managers. You will build RAG pipelines over product catalogues, write evaluation sets, and ship features behind our FastAPI backend.

Requirements: Python; FastAPI or Flask; prompt engineering; vector databases (pgvector, Pinecone or similar).
Nice to have: LangGraph or agent frameworks; a public GitHub project using LLMs; Docker.
Stipend ₹45,000/month.`,
    requirements: [
      { text: 'Python', kind: 'must', skills: ['Python'] },
      { text: 'Build APIs with FastAPI or Flask', kind: 'must', skills: ['FastAPI', 'Flask'] },
      { text: 'Prompt engineering', kind: 'must', skills: ['prompt engineering'] },
      { text: 'Vector databases such as pgvector or Pinecone', kind: 'must', skills: ['pgvector', 'Pinecone'] },
      { text: 'LangGraph or agent frameworks', kind: 'nice', skills: ['LangGraph'] },
      { text: 'Docker', kind: 'nice', skills: ['Docker'] },
    ],
  },
  {
    company: 'Bluepeak AI',
    jobDescription: `Bluepeak AI – Machine Learning Intern (remote, 6 months)

Fine-tune small language models for customer-support ticket classification and measure them properly.

Must: Python; PyTorch or TensorFlow; NLP basics; experience evaluating models.
Nice: Hugging Face Transformers; MLOps experience (MLflow, Weights & Biases).
Stipend ₹40,000/month.`,
    requirements: [
      { text: 'Python', kind: 'must', skills: ['Python'] },
      { text: 'PyTorch or TensorFlow', kind: 'must', skills: ['PyTorch', 'TensorFlow'] },
      { text: 'NLP basics', kind: 'must', skills: ['NLP'] },
      { text: 'Experience evaluating models', kind: 'must', skills: [] },
      { text: 'Hugging Face Transformers', kind: 'nice', skills: ['Hugging Face Transformers'] },
      { text: 'MLOps tools such as MLflow or Weights & Biases', kind: 'nice', skills: ['MLflow', 'Weights & Biases'] },
    ],
  },
  {
    company: 'Brightloom',
    jobDescription: `Brightloom – Applied AI Intern, Bengaluru

Help our forecasting team add LLM features to a demand-planning product used by grocery chains.

You need: Python and SQL; experience with an LLM API (OpenAI, Gemini or Claude); comfort with Git.
Good to have: time-series forecasting; Kubernetes; React for internal tools.`,
    requirements: [
      { text: 'Python and SQL', kind: 'must', skills: ['Python', 'SQL'] },
      { text: 'Experience with an LLM API (OpenAI, Gemini or Claude)', kind: 'must', skills: ['OpenAI', 'Gemini', 'Claude'] },
      { text: 'Git', kind: 'must', skills: ['Git'] },
      { text: 'Time-series forecasting', kind: 'nice', skills: ['time series'] },
      { text: 'Kubernetes', kind: 'nice', skills: ['Kubernetes'] },
      { text: 'React for internal tools', kind: 'nice', skills: ['React'] },
    ],
  },
];

// The sample candidate's answers, in the order the demo interview asks its questions
// (first answer, then an answer in case the interviewer follows up). Mixed quality
// on purpose, so the demo feedback shows strong and weak scores.
const DEMO_ANSWERS: [string, string][] = [
  [
    'In a college project two of us wanted different databases a week before submission. We talked it through and went with PostgreSQL, and we submitted on time.',
    'I suggested we list what our data needed; it had lots of joins between students and courses, so I made the case for PostgreSQL and set up the schema that evening.',
  ],
  [
    "I haven't used LangGraph yet. I would probably have one step that understands the query, then call tools like product search, and if a tool fails fall back to a simpler answer.",
    "I'd test each step on its own first. I've built multi-step flows by hand in StudyBuddy, so I would start from that and learn LangGraph's state model.",
  ],
  [
    'I split 4,000 product manuals into chunks of about 500 tokens, embedded them and stored them in pgvector, with a FastAPI service in front. I wrote 150 test questions with the support team and raised accuracy from 71% to 86% by testing chunk sizes and rewriting the prompt. If I did it again I would add keyword search earlier, because product codes matched badly with vectors alone.',
    'I owned the retrieval and evaluation parts myself; my lead reviewed the prompts.',
  ],
  [
    'Store managers need quick, correct answers, and RAG lets the assistant answer from your own product data instead of guessing.',
    'At Brightcart the chatbot answered from manuals, and measuring it with a test set is what made it trustworthy, so I would bring that habit here.',
  ],
  [
    'Our chatbot sometimes answered from the wrong manual. I logged the retrieved chunks for failing questions and saw near-duplicate chunks from two product versions outranking the right one. I added the product version as a filter before the vector search, and wrong-manual answers dropped from about 9% to under 1%.',
    'I found it by sorting the failing questions by product and noticing they were all models with two versions.',
  ],
];

async function demoInterview(job: { company: string }, questions: Question[], missing: string[]) {
  const chosen = chooseQuestions(questions, missing);
  const turns: { question_index: number; speaker: string; kind: string; content: string }[] = [];
  const graded: GradedAnswer[] = [];
  const feedback = [];
  for (const [index, question] of chosen.entries()) {
    const [answer, followUpAnswer] = DEMO_ANSWERS[index];
    turns.push({ question_index: index, speaker: 'interviewer', kind: 'question', content: question.text });
    turns.push({ question_index: index, speaker: 'candidate', kind: 'answer', content: answer });
    const decision = await decideNext({ company: job.company, role: 'AI Engineer Intern', question, answer, followUpUsed: false }, { userId: null });
    if (decision.action === 'follow_up' && decision.followUp) {
      turns.push({ question_index: index, speaker: 'interviewer', kind: 'follow_up', content: decision.followUp });
      turns.push({ question_index: index, speaker: 'candidate', kind: 'answer', content: followUpAnswer });
    }
    if (isSkip(answer)) continue;
    const result = await gradeAnswer(
      { company: job.company, role: 'AI Engineer Intern', question, answer, followUp: decision.followUp, followUpAnswer: decision.followUp ? followUpAnswer : null },
      { userId: null },
    );
    graded.push({ questionIndex: index, question, scores: result.scores, improvement: result.improvement });
    feedback.push({ question_index: index, scores: result.scores, improvement: result.improvement, model: result.model, prompt_version: result.promptVersion });
  }
  turns.push({ question_index: chosen.length - 1, speaker: 'interviewer', kind: 'closing', content: CLOSING });
  return { questions: chosen, turns, feedback, summary: { ...summarize(graded, []), skippedIndexes: [] } };
}

async function main() {
  const resumeText = fs.readFileSync(path.join(ROOT, 'evals/datasets/resumes/ai_student.txt'), 'utf8').trim();
  const parsed = await parseResume(resumeText, null);
  const jobs: Record<string, unknown>[] = [];
  for (const job of JOBS) {
    const check = await checkRequirements(job.requirements, parsed, { userId: null });
    // A question bank for the first job only, so visitors can start a mock interview straight away.
    const bank =
      jobs.length === 0
        ? await generateQuestionBank(
            { company: job.company, role: 'AI Engineer Intern', jobDescription: job.jobDescription, notes: null, requirements: job.requirements, parsed, checklist: check.verdicts },
            { userId: null },
          )
        : null;
    const interview = bank ? await demoInterview(job, bank.questions, missingMustRequirements(check.verdicts)) : null;
    // A checked cover letter for the first job, so the Drafts tab isn't empty.
    let draft = null;
    if (bank) {
      const written = await streamDraft(
        { kind: 'cover_letter', tone: 'formal', length: 'medium', candidateName: 'Riya Sharma', company: job.company, role: 'AI Engineer Intern',
          jobDescription: job.jobDescription, notes: null, contactName: null, requirements: job.requirements, checklist: check.verdicts, parsed },
        { userId: null },
        () => {},
      );
      const checked = await checkDraft(written.text.trim(), parsed, [job.jobDescription], { userId: null });
      draft = { kind: 'cover_letter', tone: 'formal', length: 'medium', content: written.text.trim(), claims: checked.claims, numberFlags: checked.numberFlags, model: written.model, promptVersion: written.promptVersion };
    }
    jobs.push({
      ...job, verdicts: check.verdicts, model: check.model, promptVersion: check.promptVersion,
      questions: bank?.questions ?? null, questionsPromptVersion: bank?.promptVersion ?? null, interview, draft,
    });
    console.log(`${job.company}: ${check.verdicts.map((v) => v.verdict).join(', ')}${bank ? `; ${bank.questions.length} questions` : ''}`);
  }
  const file = `// Generated by scripts/gen-demo-ai.ts with ${parsed.model}. Do not edit by hand.
// A synthetic resume (made-up person), requirement checks for three demo applications,
// and a question bank, a completed mock interview with feedback and a checked cover
// letter for the first one.

export const DEMO_RESUME = ${JSON.stringify({ title: 'Riya Sharma – AI internships (sample)', rawText: resumeText, parsed }, null, 2)} as const;

export const DEMO_JOBS = ${JSON.stringify(jobs, null, 2)} as const;
`;
  fs.writeFileSync(OUT, file);
  console.log(`Wrote ${path.relative(ROOT, OUT)}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
