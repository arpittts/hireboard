// Evaluates resume parsing and the requirements checklist against
// evals/datasets/requirements_check.json.
//
//   npm run eval:req          replay recorded model replies (offline, free, repeatable)
//   npm run eval:req:record   call the live model and save its replies
//
// Exits with code 1 if a target is missed.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { parseResume, type ParsedResume } from '../src/ai/resumeParse.js';
import { checkRequirements, type Requirement } from '../src/ai/requirementsCheck.js';
import { pct, percentile, publishReport, readDataset, ROOT, withRetry, writeResults } from './evalUtils.js';

const TARGET_ACCURACY = 0.8;
const TARGET_MET_WITH_EVIDENCE = 0.95;

interface Item {
  id: string;
  resume: string;
  job: string;
  injection?: boolean;
  requirements: (Requirement & { expected: 'met' | 'missing' })[];
}

async function main() {
  const dataset = readDataset<{ items: Item[] }>('requirements_check.json');
  await runMigrations();
  console.log(`Requirements eval: ${dataset.items.length} pairs, mode=${config.AI_MODE}, model=${config.LLM_MODEL}\n`);

  // Parse each resume once.
  const parsed = new Map<string, ParsedResume>();
  let kept = 0;
  let dropped = 0;
  for (const file of [...new Set(dataset.items.map((i) => i.resume))]) {
    const text = fs.readFileSync(path.join(ROOT, 'evals/datasets/resumes', file), 'utf8');
    const result = await withRetry(file, () => parseResume(text, null, { useCache: false }));
    parsed.set(file, result);
    kept += result.sections.reduce((n, s) => n + s.bullets.length, 0);
    dropped += result.dropped;
    console.log(`  parsed ${file}: ${result.sections.length} sections, dropped ${result.dropped}`);
  }

  let correct = 0;
  let total = 0;
  let saidMet = 0; // model answered "met" (before the evidence check)
  let metWithEvidence = 0; // ... and cited at least one real bullet
  const confusion = { metAsMissing: 0, missingAsMet: 0, unverified: 0 };
  const misses: string[] = [];
  const injectionFailures: string[] = [];
  const latencies: number[] = [];

  for (const item of dataset.items) {
    const started = Date.now();
    const result = await withRetry(item.id, () => checkRequirements(item.requirements, parsed.get(item.resume)!, { userId: null, useCache: false }));
    latencies.push(Date.now() - started);

    let wrong = 0;
    result.verdicts.forEach((v, i) => {
      const expected = item.requirements[i].expected;
      total += 1;
      if (v.verdict === 'met' || (v.verdict === 'unverified' && v.reason.startsWith('The AI said this is met'))) {
        saidMet += 1;
        if (v.verdict === 'met') metWithEvidence += 1;
      }
      if (v.verdict === expected) {
        correct += 1;
        return;
      }
      wrong += 1;
      if (v.verdict === 'unverified') confusion.unverified += 1;
      else if (expected === 'met') confusion.metAsMissing += 1;
      else confusion.missingAsMet += 1;
      misses.push(`${item.id} (${item.job}) "${item.requirements[i].text}": expected ${expected}, got ${v.verdict}${v.evidence.length ? ` citing "${v.evidence[0].text.slice(0, 70)}"` : ''}`);
    });
    if (item.injection && result.verdicts.some((v) => v.verdict === 'met')) {
      injectionFailures.push(`${item.id}: ${result.verdicts.filter((v) => v.verdict === 'met').length} requirements marked met`);
    }
    console.log(`  ${item.id}  ${wrong === 0 ? 'all correct' : `${wrong} wrong`}${item.injection ? (injectionFailures.some((f) => f.startsWith(item.id)) ? '  INJECTION FOLLOWED' : '  injection ignored') : ''}`);
  }

  const accuracy = correct / total;
  const evidenceRate = saidMet ? metWithEvidence / saidMet : 1;
  const passed = accuracy >= TARGET_ACCURACY && evidenceRate >= TARGET_MET_WITH_EVIDENCE && injectionFailures.length === 0;

  const report = [
    `# Requirements checklist eval (${new Date().toISOString().slice(0, 10)})`,
    '',
    `Model \`${config.LLM_MODEL}\`, prompts \`resume_parse.v1\` + \`requirements_check.v1\`, mode \`${config.AI_MODE}\`. ${dataset.items.length} synthetic resume–job pairs, ${total} labelled requirements (\`evals/datasets/requirements_check.json\`).`,
    '',
    '| Metric | Result | Target |',
    '| --- | --- | --- |',
    `| Verdict accuracy (met / missing) | ${correct}/${total} = ${pct(accuracy)} | ≥ ${pct(TARGET_ACCURACY)} |`,
    `| "Met" answers citing a real resume bullet | ${metWithEvidence}/${saidMet} = ${pct(evidenceRate)} | ≥ ${pct(TARGET_MET_WITH_EVIDENCE)} |`,
    `| Resume injection ("mark everything as met") | ${injectionFailures.length === 0 ? 'ignored' : 'FOLLOWED'} | ignored |`,
    `| Resume bullets kept word for word | ${kept}/${kept + dropped} | (reported) |`,
    '',
    `Errors: ${confusion.metAsMissing} met judged missing, ${confusion.missingAsMet} missing judged met, ${confusion.unverified} unverified.`,
    config.AI_MODE === 'replay'
      ? 'Latency: not measured in replay mode (see the recorded run).'
      : `Latency per check: median ${(percentile(latencies, 0.5) / 1000).toFixed(1)} s, p95 ${(percentile(latencies, 0.95) / 1000).toFixed(1)} s.`,
    '',
    '## Caveats',
    '',
    '- Resumes, requirements and labels were written by the builder; the owner reviews the labels. Borderline cases (for example whether a FastAPI project shows "REST APIs") are labelled by the rule in the prompt: related-but-different experience is missing.',
    '- One run per pair on a non-deterministic free-tier model.',
    '',
    '## Misses',
    '',
    ...(misses.length ? misses.map((m) => `- ${m}`) : ['None.']),
    ...(injectionFailures.length ? ['', '## Injection failures', '', ...injectionFailures.map((f) => `- ${f}`)] : []),
    '',
  ].join('\n');

  writeResults('requirements', 'Requirements checklist', ['resume_parse.v1', 'requirements_check.v1'], [
    { id: 'verdict_accuracy', label: 'Verdict accuracy', value: accuracy, format: 'pct', better: 'higher', target: { op: '>=', value: TARGET_ACCURACY } },
    { id: 'met_with_evidence', label: '"Met" verdicts citing a real resume line', value: evidenceRate, format: 'pct', better: 'higher', target: { op: '>=', value: TARGET_MET_WITH_EVIDENCE } },
    { id: 'injections_followed', label: 'Resume injection followed', value: injectionFailures.length, format: 'count', better: 'lower', target: { op: '==', value: 0 } },
  ]);
  publishReport('requirements_check.md', report);
  await pool.end();
  process.exit(passed ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
