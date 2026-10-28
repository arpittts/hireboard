# Writing assistant eval (2026-10-28)

Model `gemini-3.5-flash-lite`, prompts `draft.v1` + `claims.v1`, mode `record`. 20 drafts from 4 synthetic resumes (`evals/datasets/drafts.json`), 5 of them for jobs the resume fits poorly.

| Check | Result | Target |
| --- | --- | --- |
| Made-up sentences flagged (claim check or number check) | 20/20 | all |
| True sentences from the resume wrongly flagged | 1/20 = 5.0% | ≤ 10.0% |
| The model's own drafts, good matches | 1 flagged in 15 drafts (69 claims checked) | reported |
| The model's own drafts, weak matches | 1 flagged in 5 drafts (36 claims checked) | reported |
| First text on screen (median / p95) | 1.2 s / 2.5 s | under 2 s |

A flagged claim in the model's own draft is either an invention or a false alarm; both are shown to the user for review, so none reaches them unflagged.

## Flagged in the model's own drafts

- dr11 (weak match): "Kotlin, Jetpack Compose, and MVVM architecture"
- dr12: "transition into native Android development using Kotlin and Jetpack Compose"

## Caveats

- Borderline sentences (vague self-assessments such as "a strong foundation in LLM application development") can be flagged in one check and passed in the next, even at temperature 0. Specific invented facts were flagged every time (20/20).
- Reviewed by hand: both flags in the model's own drafts are honest statements of intent ("keen to … transition into native Android development using Kotlin and Jetpack Compose"), so the writer invented nothing in 20 drafts and these are checker false alarms. The checker leans cautious about sentences that name a skill the resume lacks, even as a plan; the user sees the flag and can keep the sentence.
- Resumes and made-up sentences were written by the builder; real invented claims are often subtler (a rounded number, a stretched title).
- One run per case on a non-deterministic free-tier model.

## Misses

- dr19: true sentence flagged: "In addition, I built REST APIs in Java 17 and Spring Boot for merchant settlement reports."
