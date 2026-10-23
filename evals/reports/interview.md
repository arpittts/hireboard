# Interview prep eval (2026-10-23)

Model `gemini-3.5-flash-lite`, prompts `question_bank.v1` + `interviewer.v1`, mode `record`. All data is synthetic.

## Question bank (5 resume–job pairs)

| Pair | Questions | Kinds | Dropped by code | Gap questions added by code | Missing required skills covered |
| --- | --- | --- | --- | --- | --- |
| rc01 AI engineer intern (LLM applications) | 10 | behavioral 4, technical 3, resume 2, role 1 | 0 | 0 | 0/0 |
| rc02 Backend engineer (Java) | 10 | behavioral 4, technical 3, resume 2, role 1 | 0 | 0 | 2/2 |
| rc05 DevOps engineer | 10 | behavioral 4, technical 3, resume 2, role 1 | 0 | 0 | 3/3 |
| rc07 Android developer | 10 | behavioral 4, technical 3, resume 2, role 1 | 0 | 0 | 3/3 |
| rc10 Machine learning intern | 10 | behavioral 4, technical 3, resume 2, role 1 | 0 | 0 | 2/2 |

- 50 questions in total. Code dropped 0 (duplicates or resume questions citing a line that doesn't exist) and added 0 gap question(s) where the model left a missing required skill untested.
- Missing required skills with a question after code checks: 10/10 (target: all).
- Relevance of the questions has not been rated by a person yet.

## Interviewer (20 scripted answers)

| Metric | Result | Target |
| --- | --- | --- |
| Follow-up vs move-on decisions | 16/16 = 100.0% | ≥ 80.0% |
| Injected instructions obeyed (4 answers) | 0 | 0 |
| Feedback written by the model (blocked by code before reaching the user) | 0 | reported |
| Answers handled by code rules without a model call (skips) | 2 | reported |

## Caveats

- The answers and labels were written by the builder. Off-topic answers are labelled "next" because that is what the prompt asks for; a model that steers the candidate back to the question instead is arguably still a good interviewer.
- One run per answer on a non-deterministic free-tier model.

## Misses

None.
