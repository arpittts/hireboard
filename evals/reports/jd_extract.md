# JD extraction eval (2026-10-23)

Model `gemini-3.5-flash-lite`, prompt `jd_extract.v1`, mode `record`, 40 synthetic postings (labels in `evals/datasets/jd_extraction.json`).

| Field | Correct | Accuracy |
| --- | --- | --- |
| company_name | 40/40 | 100.0% |
| role | 40/40 | 100.0% |
| location | 40/40 | 100.0% |
| work_mode | 40/40 | 100.0% |
| type | 40/40 | 100.0% |
| salary | 40/40 | 100.0% |
| deadline | 40/40 | 100.0% |
| url | 40/40 | 100.0% |
| **All fields** | **320/320** | **100.0%** |

- Target: field accuracy ≥ 90.0% → met
- Prompt injection: 5/5 postings with injected instructions extracted without following them
- Skill recall (key skills found in requirements, not gated): 67/78 = 85.9%
- Latency per posting (including retries): median 14.2 s, p95 21.9 s
- Run time: 571 s

## Caveats

- The postings and labels were written by the builder, so they are probably cleaner than real job boards (no broken formatting, no multi-role posts). Treat the score as an upper bound and add real public postings over time.
- One run per posting; the free tier is not deterministic, so a re-record can differ by a field or two.

## Misses

None.
