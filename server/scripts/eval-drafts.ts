// Evaluates the writing assistant against evals/datasets/drafts.json.
//
//   npm run eval:drafts          replay recorded model replies (offline, free, repeatable)
//   npm run eval:drafts:record   call the live model and save its replies
//
// For each case: write the draft, check it, then check it again with one made-up
// sentence (must be flagged) and one true sentence from the resume (must not be)
// added. Exits with code 1 if a target is missed.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { parseResume, type ParsedResume } from '../src/ai/resumeParse.js';
import { checkDraft, numbersIn, streamDraft, type DraftKind } from '../src/ai/drafts.js';
import type { Requirement } from '../src/ai/requirementsCheck.js';
import { pct, percentile, publishReport, readDataset, ROOT, withRetry, writeResults } from './evalUtils.js';

const TARGET_FABRICATIONS_FLAGGED = 1; // every one
const MAX_FALSE_ALARM_RATE = 0.1;

interface Case {
  id: string; resume: string; requirementsFrom: string; company: string; role: string;
  kind: DraftKind; tone: 'formal' | 'friendly'; length: 'short' | 'medium'; weakMatch: boolean; fabrication: string;
}

const squash = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, ' ').trim();
const overlaps = (claim: string, sentence: string) => squash(sentence).includes(squash(claim)) || squash(claim).includes(squash(sentence));

// A true sentence built from a resume line that describes something the candidate did.
function trueSentence(parsed: ParsedResume): string {
  const lines = parsed.sections.filter((s) => s.kind === 'experience' || s.kind === 'projects').flatMap((s) => s.bullets);
  const line = lines.find((b) => /^(Built|Wrote|Cleaned|Added|Turned|Analysed|Trained|Containerised|Generates|Took)\b/.test(b.text)) ?? lines[0];
  const text = line.text.replace(/\.$/, '');
  return `In addition, I ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}

// Adds both test sentences as a new paragraph after the first one.
function withTestSentences(draft: string, fabrication: string, truth: string): string {
  const paragraphs = draft.split(/\n\s*\n/);
  paragraphs.splice(Math.min(2, paragraphs.length - 1), 0, `${fabrication} ${truth}`);
  return paragraphs.join('\n\n');
}

async function main() {
  const dataset = readDataset<{ items: Case[] }>('drafts.json');
  const pairs = new Map(readDataset<{ items: { id: string; requirements: Requirement[] }[] }>('requirements_check.json').items.map((i) => [i.id, i.requirements]));
  await runMigrations();
  console.log(`Drafts eval: ${dataset.items.length} cases, mode=${config.AI_MODE}, model=${config.LLM_MODEL}\n`);

  // Resumes come from the other evals' recordings (replay), never fresh calls: a new
  // parse could number the lines differently and break those recordings.
  const mode = config.AI_MODE;
  config.AI_MODE = 'replay';
  const parsed = new Map<string, ParsedResume>();
  for (const file of new Set(dataset.items.map((c) => c.resume))) {
    parsed.set(file, await parseResume(fs.readFileSync(path.join(ROOT, 'evals/datasets/resumes', file), 'utf8'), null, { useCache: false }));
  }
  config.AI_MODE = mode;

  let fabricationsFlagged = 0;
  let falseAlarms = 0;
  const firstText: number[] = [];
  const raw = { weak: { drafts: 0, claims: 0, flagged: 0 }, normal: { drafts: 0, claims: 0, flagged: 0 } };
  const misses: string[] = [];
  const examples: string[] = [];

  for (const c of dataset.items) {
    const resume = parsed.get(c.resume)!;
    const draft = await withRetry(c.id, () =>
      streamDraft(
        { kind: c.kind, tone: c.tone, length: c.length, candidateName: 'Alex Rao', company: c.company, role: c.role,
          jobDescription: null, notes: null, contactName: null, requirements: pairs.get(c.requirementsFrom) ?? [], checklist: null, parsed: resume },
        { userId: null },
        () => {},
      ),
    );
    if (draft.firstTextMs !== null) firstText.push(draft.firstTextMs);
    const sources = [c.company, c.role];

    // 1. The model's own draft.
    const plain = await withRetry(`${c.id} check`, () => checkDraft(draft.text, resume, sources, { userId: null, useCache: false }));
    const bucket = c.weakMatch ? raw.weak : raw.normal;
    const flagged = plain.claims.filter((x) => !x.supported).length + plain.numberFlags.length;
    bucket.drafts += 1;
    bucket.claims += plain.claims.length;
    bucket.flagged += flagged;
    if (flagged) examples.push(`${c.id}${c.weakMatch ? ' (weak match)' : ''}: ${[...plain.claims.filter((x) => !x.supported).map((x) => `"${x.text}"`), ...plain.numberFlags.map((n) => `number ${n}`)].join('; ')}`);

    // 2. The same draft with a made-up sentence and a true one added.
    const truth = trueSentence(resume);
    const tested = await withRetry(`${c.id} test`, () =>
      checkDraft(withTestSentences(draft.text, c.fabrication, truth), resume, sources, { userId: null, useCache: false }),
    );
    const fabNumbers = numbersIn(c.fabrication);
    const caught = tested.claims.some((x) => !x.supported && overlaps(x.text, c.fabrication)) || fabNumbers.some((n) => tested.numberFlags.includes(n));
    const falseAlarm = tested.claims.some((x) => !x.supported && overlaps(x.text, truth));
    if (caught) fabricationsFlagged += 1;
    else misses.push(`${c.id}: made-up sentence not flagged: "${c.fabrication}"`);
    if (falseAlarm) {
      falseAlarms += 1;
      misses.push(`${c.id}: true sentence flagged: "${truth}"`);
    }
    console.log(`  ${c.id}  ${draft.text.split(/\s+/).length} words, first text ${draft.firstTextMs ?? '-'} ms, own draft flagged ${flagged}, made-up ${caught ? 'caught' : 'MISSED'}${falseAlarm ? ', FALSE ALARM' : ''}`);
  }

  const n = dataset.items.length;
  const recall = fabricationsFlagged / n;
  const falseAlarmRate = falseAlarms / n;
  const passed = recall >= TARGET_FABRICATIONS_FLAGGED && falseAlarmRate <= MAX_FALSE_ALARM_RATE;
  const rate = (b: { claims: number; flagged: number; drafts: number }) => `${b.flagged} flagged in ${b.drafts} drafts (${b.claims} claims checked)`;

  const report = [
    `# Writing assistant eval (${new Date().toISOString().slice(0, 10)})`,
    '',
    `Model \`${config.LLM_MODEL}\`, prompts \`draft.v1\` + \`claims.v1\`, mode \`${config.AI_MODE}\`. ${n} drafts from 4 synthetic resumes (\`evals/datasets/drafts.json\`), 5 of them for jobs the resume fits poorly.`,
    '',
    '| Check | Result | Target |',
    '| --- | --- | --- |',
    `| Made-up sentences flagged (claim check or number check) | ${fabricationsFlagged}/${n} | all |`,
    `| True sentences from the resume wrongly flagged | ${falseAlarms}/${n} = ${pct(falseAlarmRate)} | ≤ ${pct(MAX_FALSE_ALARM_RATE)} |`,
    `| The model's own drafts, good matches | ${rate(raw.normal)} | reported |`,
    `| The model's own drafts, weak matches | ${rate(raw.weak)} | reported |`,
    mode === 'replay'
      ? '| First text on screen | not measured in replay mode | under 2 s |'
      : `| First text on screen (median / p95) | ${(percentile(firstText, 0.5) / 1000).toFixed(1)} s / ${(percentile(firstText, 0.95) / 1000).toFixed(1)} s | under 2 s |`,
    '',
    'A flagged claim in the model\'s own draft is either an invention or a false alarm; both are shown to the user for review, so none reaches them unflagged.',
    '',
    '## Flagged in the model\'s own drafts',
    '',
    ...(examples.length ? examples.map((e) => `- ${e}`) : ['None.']),
    '',
    '## Caveats',
    '',
    '- A flag in the model\'s own draft needs a human look: in the recorded run both were honest statements of intent ("keen to learn Kotlin"), i.e. checker false alarms, not inventions.',
    '- Borderline sentences (vague self-assessments such as "a strong foundation in LLM application development") can be flagged in one check and passed in the next, even at temperature 0. Specific invented facts were flagged every time.',
    '- Resumes and made-up sentences were written by the builder; real invented claims are often subtler (a rounded number, a stretched title).',
    '- One run per case on a non-deterministic free-tier model.',
    '',
    '## Misses',
    '',
    ...(misses.length ? misses.map((m) => `- ${m}`) : ['None.']),
    '',
  ].join('\n');

  writeResults('drafts', 'Writing assistant', ['resume_parse.v1', 'draft.v1', 'claims.v1'], [
    { id: 'fabrications_flagged', label: 'Made-up sentences flagged', value: recall, format: 'pct', better: 'higher', target: { op: '>=', value: TARGET_FABRICATIONS_FLAGGED } },
    { id: 'false_alarm_rate', label: 'True resume sentences wrongly flagged', value: falseAlarmRate, format: 'pct', better: 'lower', target: { op: '<=', value: MAX_FALSE_ALARM_RATE } },
  ]);
  publishReport('drafts.md', report);
  await pool.end();
  process.exit(passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
