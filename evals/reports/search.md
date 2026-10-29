# Search eval (2026-10-29)

Embedding model `gemini-embedding-2` (768 dimensions), mode `replay`. 20 labelled queries over the 40 synthetic postings of `jd_extraction.json` (`evals/datasets/search.json`). As in the app, at most 5 meaning matches are kept, each with a cosine similarity of at least 0.6 and within 0.05 of the best match (similarities from this model are compressed into roughly 0.55–0.75, so the gap separates relevant from unrelated far better than an absolute floor).

| Method | Mean recall@5 |
| --- | --- |
| Keyword only (Postgres full-text search, every word) | 38.3% |
| Meaning only (pgvector) | 84.0% |
| **Hybrid (reciprocal rank fusion)** | **87.5%** |

Target: hybrid ≥ both → met.

Noise: hybrid search showed 3.3 results per query on average (up to 10), 56.1% of them relevant. With only an absolute floor of 0.55 (the first version) it showed 10.0 per query, 20.0% relevant, for 91.7% hybrid recall; the gap rule alone, 4.2 per query, 45.8% relevant. The cut-offs give up a few points of recall for far less noise.

When meaning search is unavailable (AI off, quota used up, provider down) the app falls back to keyword search that also accepts applications with only some of the words: 79.2% recall@5. Hybrid search keeps the every-word form, because adding partial matches to the fused ranking lowered hybrid recall (85.0% in a trial run).

## Per query

| Query | Kind | Keyword | Keyword, some words | Meaning | Hybrid |
| --- | --- | --- | --- | --- | --- |
| Kafka | exact term | 50.0% | 50.0% | 50.0% | 100.0% |
| chatbot jobs | paraphrase: RAG / assistant roles never say 'chatbot' | 0.0% | 0.0% | 0.0% | 0.0% |
| large language models | mixed | 0.0% | 33.3% | 100.0% | 100.0% |
| keeping servers running and on-call | paraphrase | 0.0% | 66.7% | 66.7% | 66.7% |
| mobile app development | paraphrase | 50.0% | 100.0% | 100.0% | 100.0% |
| internship in Bengaluru | mixed | 0.0% | 66.7% | 100.0% | 100.0% |
| Kubernetes | exact term | 100.0% | 100.0% | 80.0% | 100.0% |
| work with designers on user interfaces | paraphrase | 0.0% | 66.7% | 66.7% | 66.7% |
| data dashboards and reporting | mixed | 0.0% | 100.0% | 100.0% | 100.0% |
| computer vision research | mixed | 100.0% | 100.0% | 100.0% | 100.0% |
| teaching and helping learners | paraphrase | 0.0% | 100.0% | 100.0% | 100.0% |
| security monitoring | mixed | 100.0% | 100.0% | 100.0% | 100.0% |
| Postgres database administration | mixed | 0.0% | 100.0% | 50.0% | 50.0% |
| games | exact term | 100.0% | 100.0% | 100.0% | 100.0% |
| remote freelance work | mixed | 66.7% | 100.0% | 100.0% | 100.0% |
| fintech payments backend | mixed | 0.0% | 100.0% | 66.7% | 66.7% |
| speech recognition for Indian languages | paraphrase | 0.0% | 100.0% | 100.0% | 100.0% |
| Spring Boot | exact term | 100.0% | 100.0% | 100.0% | 100.0% |
| robots | exact-ish term | 100.0% | 100.0% | 100.0% | 100.0% |
| writing documentation | paraphrase | 0.0% | 0.0% | 100.0% | 100.0% |

## Caveats

- Queries and relevance labels were written by the builder; 40 applications is a small corpus, so a single query moves the averages by several points.
- "chatbot jobs" fails on every method: no posting says "chatbot", and the embedding puts "Research Assistant" and "Teaching Assistant" postings (similarity ~0.70) above the two RAG / LLM-assistant roles. A known weakness of embeddings with an ambiguous word.
- On a set of very similar applications (the demo account: 12 software and AI internships) the cut-offs still let through up to 5 loosely related meaning matches, because every posting is close to every other.
- Keyword search requires every word of the query, so multi-word phrasings ("writing documentation") often match nothing; hybrid relies on meaning search for those.
