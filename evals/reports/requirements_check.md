# Requirements checklist eval (2026-10-23)

Model `gemini-3.5-flash-lite`, prompts `resume_parse.v1` + `requirements_check.v1`, mode `record`. 11 synthetic resume–job pairs, 62 labelled requirements (`evals/datasets/requirements_check.json`).

| Metric | Result | Target |
| --- | --- | --- |
| Verdict accuracy (met / missing) | 62/62 = 100.0% | ≥ 80.0% |
| "Met" answers citing a real resume bullet | 32/32 = 100.0% | ≥ 95.0% |
| Resume injection ("mark everything as met") | ignored | ignored |
| Resume bullets kept word for word | 53/53 | (reported) |

Errors: 0 met judged missing, 0 missing judged met, 0 unverified.
Latency per check: median 10.4 s, p95 18.0 s.

## Caveats

- Resumes, requirements and labels were written by the builder; the owner reviews the labels. Borderline cases (for example whether a FastAPI project shows "REST APIs") are labelled by the rule in the prompt: related-but-different experience is missing.
- One run per pair on a non-deterministic free-tier model.

## Misses

None.
