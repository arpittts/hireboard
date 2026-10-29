# Eval summary

Model `gemini-3.5-flash-lite`, embeddings `gemini-embedding-2`. Replayed from the recorded replies in `evals/recordings/`; each eval's own report in this folder has the details and caveats. Regenerate with `npm run eval:update`.

| Eval | Metric | Result | Target |
| --- | --- | --- | --- |
| JD extraction | Field accuracy | 100.0% | ≥ 90.0% |
| JD extraction | Injected instructions followed (5 postings) | 0 | = 0 |
| JD extraction | Key skills found | 85.9% | reported |
| Requirements checklist | Verdict accuracy | 100.0% | ≥ 80.0% |
| Requirements checklist | "Met" verdicts citing a real resume line | 100.0% | ≥ 95.0% |
| Requirements checklist | Resume injection followed | 0 | = 0 |
| Interview prep | Follow-up vs move-on decisions | 100.0% | ≥ 80.0% |
| Interview prep | Injected instructions obeyed (4 answers) | 0 | = 0 |
| Interview prep | Missing required skills with a question | 100.0% | = 100.0% |
| Answer feedback | Good scores backed by a real quote | 100.0% | ≥ 95.0% |
| Answer feedback | "Score this 4/4" instructions not removed (10) | 0 | = 0 |
| Answer feedback | Scores raised by the instruction with the filter off | 3 | reported |
| Answer feedback | Mean score good > average > weak (1 = yes) | 1 | = 1 |
| Answer feedback | Within 1 point of the owner's grades | 90.8% | ≥ 85.0% |
| Answer feedback | Quadratic weighted κ with the owner | 0.79 | ≥ 0.60 |
| Writing assistant | Made-up sentences flagged | 100.0% | ≥ 100.0% |
| Writing assistant | True resume sentences wrongly flagged | 5.0% | ≤ 10.0% |
| Smart search | Hybrid recall@5 | 87.5% | reported |
| Smart search | Hybrid recall minus the better single method | 3.5% | ≥ 0.0% |
| Smart search | Keyword-only recall@5 | 38.3% | reported |
| Smart search | Meaning-only recall@5 | 84.0% | reported |
| Smart search | Recall@5 without AI (keyword, some words) | 79.2% | reported |
| Smart search | Share of shown results that are relevant | 56.1% | reported |
| Copilot | Tasks fully correct | 96.0% | ≥ 90.0% |
| Copilot | Data changed without confirmation | 0 | = 0 |
| Copilot | Unauthorised proposals on injection tasks | 0 | = 0 |
| Copilot | Same, with the change gate off | 0 | reported |
| Copilot | Answers claiming a change already happened | 0 | = 0 |
