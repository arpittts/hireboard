// Runs every eval and gates on the results.
//
//   npm run eval           replay all evals (offline, free), compare with the committed
//                          numbers in evals/reports/metrics.json; exit 1 on a missed
//                          target, a regression, or a committed report that is out of date
//   npm run eval:update    the same, then rewrite evals/reports/summary.md, metrics.json
//                          and the metrics table in README.md
//   npm run eval:record -- --only=copilot,search
//                          call the live model for those evals, then update (uses quota)
//
// Before replaying it checks that every prompt file still matches the text the
// recordings were made with (evals/recordings/manifest.json): an edited prompt
// can't be replayed, and the message says which eval to re-record.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { MANIFEST_FILE, type Manifest, type Metric, meetsTarget, pct, promptHash, PROMPTS_DIR, RESULTS_DIR, ROOT } from './evalUtils.js';

// Each eval: its script and the prompts its recordings depend on.
const EVALS = [
  { id: 'jd', script: 'eval-jd.ts', record: 'eval:jd:record' },
  { id: 'requirements', script: 'eval-requirements.ts', record: 'eval:req:record' },
  { id: 'interview', script: 'eval-interview.ts', record: 'eval:interview:record' },
  { id: 'feedback', script: 'eval-feedback.ts', record: 'eval:feedback:record' },
  { id: 'drafts', script: 'eval-drafts.ts', record: 'eval:drafts:record' },
  { id: 'search', script: 'eval-search.ts', record: 'eval:search:record' },
  { id: 'copilot', script: 'eval-copilot.ts', record: 'eval:copilot:record' },
];

const BASELINE_FILE = path.join(ROOT, 'evals/reports/metrics.json');
const SUMMARY_FILE = path.join(ROOT, 'evals/reports/summary.md');
const README_FILE = path.join(ROOT, 'README.md');
const README_START = '<!-- eval-metrics:start -->';
const README_END = '<!-- eval-metrics:end -->';

interface Result { eval: string; title: string; prompts: string[]; metrics: Metric[]; passed: boolean }
type Baseline = Record<string, Record<string, number>>;

const args = process.argv.slice(2);
const update = args.includes('--update');
const record = args.includes('--record');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const selected = only ? EVALS.filter((e) => only.includes(e.id)) : EVALS;

const show = (m: Metric, value = m.value) => (m.format === 'pct' ? pct(value) : m.format === 'number' ? value.toFixed(2) : String(value));
const targetText = (m: Metric) => (m.target ? `${m.target.op === '==' ? '=' : m.target.op === '>=' ? '≥' : '≤'} ${show(m, m.target.value)}` : 'reported');

// --- 1. Prompts and models must match what the recordings were made with ----------

function checkRecordings(): string[] {
  if (!fs.existsSync(MANIFEST_FILE)) return ['evals/recordings/manifest.json is missing. Re-record with `npm run eval:record`.'];
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const problems: string[] = [];
  if (manifest.model !== config.LLM_MODEL) {
    problems.push(`LLM_MODEL is \`${config.LLM_MODEL}\` but the recordings were made with \`${manifest.model}\`. Re-record every eval (\`npm run eval:record\`) or set LLM_MODEL back.`);
  }
  if (manifest.embeddingModel !== config.EMBEDDING_MODEL) {
    problems.push(`EMBEDDING_MODEL is \`${config.EMBEDDING_MODEL}\` but the recordings were made with \`${manifest.embeddingModel}\`. Re-record search and copilot or set it back.`);
  }
  const files = fs.readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  for (const name of files) {
    const recorded = manifest.prompts[name];
    if (!recorded) problems.push(`Prompt \`${name}\` has no recordings yet. Record the eval that uses it.`);
    else if (recorded !== promptHash(name)) {
      const users = lastResults().filter((r) => r.prompts.includes(name)).map((r) => EVALS.find((e) => e.id === r.eval)!.record);
      problems.push(
        `Prompt \`server/prompts/${name}.md\` changed since its replies were recorded, so they can no longer be replayed. ` +
          `Either undo the change, or re-record with the live model (needs GEMINI_API_KEY): ` +
          `${users.length ? users.map((u) => `\`npm run ${u}\``).join(', ') : '`npm run eval:record`'}, then \`npm run eval:update\` and commit the recordings and reports.`,
      );
    }
  }
  return problems;
}

// Prompt lists come from the committed results, so the check works before any run.
function lastResults(): Result[] {
  if (!fs.existsSync(BASELINE_FILE)) return [];
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return Object.entries(baseline.prompts ?? {}).map(([id, prompts]) => ({ eval: id, prompts: prompts as string[] }) as Result);
}

// --- 2. Run each eval in its own process ---------------------------------------------

function runEval(e: (typeof EVALS)[number]): { result: Result | null; output: string } {
  fs.rmSync(path.join(RESULTS_DIR, `${e.id}.json`), { force: true });
  // Each eval's own report is written by its record run (it has live-only numbers such
  // as latency); this runner only writes the summary, the baseline and the README table.
  const child = spawnSync('npx', ['tsx', `scripts/${e.script}`], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, AI_MODE: record ? 'record' : 'replay' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  const file = path.join(RESULTS_DIR, `${e.id}.json`);
  return { result: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null, output };
}

// --- 3. Compare and report ------------------------------------------------------------

function main() {
  console.log(`Evals: ${selected.map((e) => e.id).join(', ')} (${record ? 'record' : 'replay'}${update ? ', update reports' : ''})\n`);

  if (!record) {
    const problems = checkRecordings();
    if (problems.length) {
      console.error('Recordings are out of date:\n');
      for (const p of problems) console.error(`- ${p}\n`);
      process.exit(1);
    }
  }

  const baseline: Baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).metrics : {};
  const results: Result[] = [];
  const failures: string[] = [];
  const changes: string[] = [];

  for (const e of selected) {
    const started = Date.now();
    const { result, output } = runEval(e);
    if (!result) {
      console.log(`✗ ${e.id}: crashed`);
      failures.push(`${e.id} did not finish:\n${output.split('\n').slice(-25).join('\n')}`);
      continue;
    }
    results.push(result);
    const lines: string[] = [];
    for (const m of result.metrics) {
      const before = baseline[e.id]?.[m.id];
      const worse = before !== undefined && ((m.better === 'higher' && m.value < before) || (m.better === 'lower' && m.value > before));
      if (!meetsTarget(m)) failures.push(`${e.id}: ${m.label} is ${show(m)}, target ${targetText(m)}`);
      if (worse) failures.push(`${e.id}: ${m.label} dropped from ${show(m, before)} to ${show(m)} (regression)`);
      else if (before === undefined) changes.push(`${e.id}: new metric ${m.label} = ${show(m)}`);
      else if (before !== m.value) changes.push(`${e.id}: ${m.label} ${show(m, before)} → ${show(m)}`);
      lines.push(`    ${meetsTarget(m) && !worse ? ' ' : '✗'} ${m.label}: ${show(m)}${m.target ? ` (target ${targetText(m)})` : ''}${before !== undefined && before !== m.value ? ` [was ${show(m, before)}]` : ''}`);
    }
    console.log(`${result.passed ? '✓' : '✗'} ${result.title} (${((Date.now() - started) / 1000).toFixed(0)} s)\n${lines.join('\n')}`);
  }

  const table = [
    '| Eval | Metric | Result | Target |',
    '| --- | --- | --- | --- |',
    ...results.flatMap((r) => r.metrics.map((m) => `| ${r.title} | ${m.label} | ${show(m)} | ${targetText(m)} |`)),
  ].join('\n');

  const readme = fs.readFileSync(README_FILE, 'utf8');
  const block = `${README_START}\n${table}\n${README_END}`;
  const readmeCurrent = only || readme.includes(block);

  if (update && !only) {
    fs.writeFileSync(
      BASELINE_FILE,
      JSON.stringify(
        {
          model: config.LLM_MODEL,
          metrics: Object.fromEntries(results.map((r) => [r.eval, Object.fromEntries(r.metrics.map((m) => [m.id, m.value]))])),
          prompts: Object.fromEntries(results.map((r) => [r.eval, r.prompts])),
        },
        null,
        2,
      ) + '\n',
    );
    fs.writeFileSync(
      SUMMARY_FILE,
      [
        '# Eval summary',
        '',
        `Model \`${config.LLM_MODEL}\`, embeddings \`${config.EMBEDDING_MODEL}\`. Replayed from the recorded replies in \`evals/recordings/\`; each eval's own report in this folder has the details and caveats. Regenerate with \`npm run eval:update\`.`,
        '',
        table,
        '',
      ].join('\n'),
    );
    const start = readme.indexOf(README_START);
    const end = readme.indexOf(README_END);
    if (start < 0 || end < 0) failures.push(`README.md has no ${README_START} … ${README_END} markers for the metrics table.`);
    else fs.writeFileSync(README_FILE, readme.slice(0, start) + block + readme.slice(end + README_END.length));
    console.log('\nUpdated evals/reports/summary.md, evals/reports/metrics.json and the README metrics table.');
  } else if (!update && !record) {
    // The committed reports must describe this code: any change has to be committed.
    if (changes.length) failures.push(`The committed numbers in evals/reports/metrics.json are out of date:\n  ${changes.join('\n  ')}\nRun \`npm run eval:update\` and commit evals/reports/ and README.md.`);
    if (!readmeCurrent) failures.push('The metrics table in README.md does not match these results. Run `npm run eval:update` and commit README.md.');
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## AI eval gate\n\n${table}\n\n${failures.length ? `**${failures.length} problem(s):**\n\n${failures.map((f) => `- ${f.replace(/\n/g, ' ')}`).join('\n')}` : 'All evals passed and match the committed reports.'}\n`,
    );
  }

  if (failures.length) {
    console.error(`\n${failures.length} problem(s):\n`);
    for (const f of failures) console.error(`- ${f}\n`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} evals passed${update || record ? '' : ' and match the committed reports'}.`);
  if (record) console.log('Recorded. Now run `npm run eval:update` (replays everything) and commit evals/recordings/, evals/reports/ and README.md.');
}

main();
