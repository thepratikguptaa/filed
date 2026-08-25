# Filed

Agentic RAG over SEC filings, with source-backed citations and a retrieval evaluation harness.

This is a research and analysis tool. It surfaces cited evidence from public filings. It does not provide investment advice.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run check                # verifies env, database, embedding deployment and EDGAR access
npm run migrate
```

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection string, Session pooler on port 5432 |
| `AZURE_OPENAI_ENDPOINT` | Resource root, e.g. `https://<resource>.openai.azure.com/` — deployment paths are added by the client |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | A `text-embedding-3-small` deployment, 1536 dimensions |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat deployment used by the answer layer |
| `SEC_USER_AGENT` | Identifies you to EDGAR, e.g. `Filed Research you@example.com` |

Embeddings run on Azure OpenAI behind the `Embedder` interface in [lib/embed](lib/embed), so swapping to a local ONNX model via transformers.js means adding one file. The embedding dimension must match `vector(1536)` in the schema.

## Corpus

Two most recent 10-Ks for five companies across different sectors:

| Ticker | Company | Sector | CIK |
| --- | --- | --- | --- |
| AAPL | Apple Inc. | Technology | 0000320193 |
| MSFT | Microsoft Corporation | Technology | 0000789019 |
| JPM | JPMorgan Chase & Co. | Financials | 0000019617 |
| XOM | Exxon Mobil Corporation | Energy | 0000034088 |
| PFE | Pfizer Inc. | Healthcare | 0000078003 |

CIKs are pinned rather than resolved from the ticker map, because `XOM` now maps to a holding-company CIK with no 10-K history.

## Commands

```bash
npm run ingest -- --dry               # parse + chunk only, no database or API calls
npm run ingest                        # fetch, parse, chunk, embed, store
npm run ingest -- --companies=AAPL,JPM --years=1
npm run ingest -- --force             # re-ingest even if content is unchanged
npm run query -- "how does Apple describe supply chain concentration risk?"
npm run query -- "net interest income" --ticker=JPM --year=2025 --section="Item 1A" --k=10
```

Raw filings are cached under `data/raw/` so re-ingestion never re-downloads. Ingestion is idempotent: a filing whose content hash is unchanged is skipped, and chunk embeddings are reused across runs by content hash.

## Asking questions

```bash
npm run dev     # http://localhost:3000
```

Question in, cited answer out, with the retrieved passages and their scores beside it. Citation markers in the answer are interactive: hovering one highlights its source, clicking scrolls to it.

`POST /api/ask` takes `{ question, strategy?, k? }` and returns the answer, the ordered citations, the retrieved chunks, and which chunk ids the model actually cited.

Grounding rules live in the system prompt in [lib/answer.ts](lib/answer.ts): answer only from the supplied sources, cite inline, quote figures exactly, name the company and fiscal year, say plainly when the sources fall short, and never phrase anything as investment advice.

The LLM sits behind the `LlmProvider` interface in [lib/llm](lib/llm), so swapping Azure for Gemini or Groq is one file.

## Evaluation

The golden set is human-labelled. Candidate chunks are proposed by retrieval; a person decides which ones genuinely answer each question.

```bash
npm run label                  # label every unlabelled question
npm run label -- --id=q08      # revisit one question
npm run label -- --all         # revisit everything, including labelled
npm run eval                   # run the golden set, print metrics, append history
npm run eval -- --strategy=vector --k=10 --no-history
```

In the labeller: type candidate numbers to toggle them, `m` for more candidates, `s` to save and move on, `k` to skip, `q` to quit. Progress is written to `eval/golden.json` after every save.

Each label stores the chunk id **and** a normalised text anchor from that chunk. Chunk ids change whenever chunk size or the parser changes, so id-only labels would be invalidated by exactly the experiments the harness exists to run. A chunk counts as relevant if its id matches or its text contains the anchor, which keeps labels usable across re-chunking.

Metrics are recall@3, recall@5, recall@10 and MRR, reported overall and per category. No LLM is involved. Every run appends a summary to `eval/history.jsonl` so deltas across milestones stay visible.

| file | contents |
| --- | --- |
| `eval/questions.draft.json` | proposed questions, no labels |
| `eval/proposed-labels.json` | question id to chunk id mapping, applied by `npm run apply-labels` |
| `eval/golden.json` | the labelled golden set, with `labelledBy` recording its provenance |
| `eval/history.jsonl` | one line per eval run |

Supporting tools used to locate candidate answers while labelling:

```bash
npm run candidates -- --from=1 --to=6   # union of vector, filtered-vector and lexical candidates
npm run find -- "employed approximately [0-9,]+" --ticker=MSFT
npm run apply-labels                    # write golden.json from proposed-labels.json
```

### Measured results

| milestone | strategy | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| M1 baseline | vector | 17.2% | 25.3% | 35.1% | 0.235 |
| M3 first cut | keyword only (AND) | 6.9% | 10.3% | 10.3% | 0.089 |
| M3 first cut | hybrid, RRF k=60 | 17.2% | **32.2%** | 42.0% | 0.245 |
| M3 fixed | keyword only (AND→OR) | 16.7% | 23.6% | 33.3% | 0.173 |
| **M3 final** | **hybrid, RRF k=5** | **19.0%** | 25.3% | **44.8%** | **0.304** |

Against the vector baseline: recall@10 **+9.7pts**, recall@3 **+1.8pts**, MRR **+0.069**. Single-fact questions gained most (30.6% → 61.1% recall@10, MRR 0.274 → 0.449) and numeric questions went 21.4% → 42.9%.

One metric moved the wrong way: recall@5 is 25.3%, below the 32.2% that RRF k=60 produced. The `rrfK` sweep gives recall@10 of 44.8/43.7/38.5/42.0 and MRR of 0.304/0.284/0.281/0.245 at k = 5/10/20/60. k=5 was chosen because it wins on both MRR and recall@10, and the answer layer reads the top 8 — but the recall@5 regression is real, and k=60 is the better setting if middle-depth recall matters more for your use.

**The keyword half was broken on first implementation.** `websearch_to_tsquery` ANDs every term, so a natural-language question required a chunk containing all of them, and keyword search returned nothing for 25 of 29 questions. It now tries the strict AND query first and falls back to an OR query for the remaining slots, which took keyword-only recall@10 from 10.3% to 33.3%. Diagnosing this needed [scripts/diagnose.ts](scripts/diagnose.ts), which reports the rank of each labelled chunk per strategy at depth 200 — a `—` there means genuinely unreachable, which is a different problem from ranked-too-low.

Fusion pool size (`candidateK`) at 15/30/50 gives recall@10 of 40.2/43.7/44.8; it saturates at 50 because keyword search often returns fewer candidates than that.

Both `rrfK` and `candidateK` are tuned against 29 questions, which is a small sample. Treat them as reasonable defaults rather than settled constants.

### M4 — reranking

A cross-encoder rescores the fused top-N before the chunks reach the LLM.

| reranker | rerankN | recall@3 | recall@5 | recall@10 | MRR | rerank latency |
| --- | --- | --- | --- | --- | --- | --- |
| none (M3 hybrid) | — | 19.0% | 25.3% | 44.8% | 0.304 | — |
| ms-marco-MiniLM-L-6-v2 | 30 | **28.7%** | 37.4% | 43.7% | 0.303 | ~6.5s |
| bge-reranker-base | 12 | 30.5% | 43.7% | 50.0% | 0.394 | ~20s |
| bge-reranker-base | 30 | 27.6% | **47.7%** | **54.6%** | **0.390** | ~50s |

Reranking does what a reranker should: it lifts relevant chunks into the shallow ranks the answer layer actually reads, rather than finding anything new. With bge at N=30, recall@5 nearly doubles against unreranked hybrid.

The two models are a genuine speed/quality trade. `bge-reranker-base` is 278M parameters against MiniLM's 22M, and measured 1,684ms per pair versus 218ms on this machine. MiniLM is the default because it keeps an end-to-end answer around 10s; bge is one env var away and is the better choice for offline eval or if you accept ~50s per question:

```bash
RERANK_MODEL=Xenova/bge-reranker-base npm run eval -- --strategy=hybrid+rerank
```

Note MiniLM's recall@10 (43.7%) is slightly *below* unreranked hybrid (44.8%). Reranking only reorders the fused top-N, so a relevant chunk at fused rank 25 can be pushed out of the top 10. It buys shallow precision with deep recall.

### M5 — agentic retrieval

The model drives retrieval instead of receiving one blind top-k. It plans searches from the question, rewrites them into filing vocabulary, applies company/year/section filters, judges whether the results answer the question, and searches again when they do not.

Caps are hard: 3 iterations, 6 searches, and every duplicated query is skipped. Each search is a full `hybrid+rerank` retrieval, and results from different searches are interleaved so every hop contributes to the top of the list rather than one hop dominating it.

Two behaviours account for most of the gain. Decomposition — *"How did JPMorgan's net interest income change from FY2024 to FY2025?"* becomes two filtered searches, one per year, which puts the FY2025 figure at rank 2 where unreranked hybrid had it at rank 61. And vocabulary rewriting — *"capital expenditures"* becomes *"Additions to property and equipment"*, which is what Microsoft's cash flow statement actually says, retrieving a chunk that was unreachable at depth 200 by any single-shot strategy.

`perSearchK` matters more than it looks. At 5, a simple one-search question yields only five candidates in total, capping recall@10 at recall@5 — single-fact recall@10 was 38.9%. Raising it to 10 took that to 83.3%.

### Results summary

| milestone | strategy | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| M1 | vector | 17.2% | 25.3% | 35.1% | 0.235 |
| M3 | hybrid (RRF) | 19.0% | 25.3% | 44.8% | 0.304 |
| M4 | hybrid + MiniLM rerank | 28.7% | 37.4% | 43.7% | 0.303 |
| M4 | hybrid + bge rerank | 27.6% | 47.7% | 54.6% | 0.390 |
| **M5** | **agentic** | **39.7%** | **54.6%** | **75.9%** | **0.501** |

Baseline to agentic: recall@10 **+40.8pts**, recall@5 **+29.3pts**, MRR **+0.266**. Questions with no relevant chunk in the top 10 fell from 15 of 29 to 5.

Cross-document subset, which is what the agent exists for:

| strategy | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- |
| vector | 16.7% | 16.7% | 25.0% | 0.194 |
| hybrid | 16.7% | 16.7% | 16.7% | 0.167 |
| hybrid + bge rerank | 16.7% | 25.0% | 41.7% | 0.224 |
| **agentic** | 16.7% | **41.7%** | **58.3%** | **0.357** |

Single-shot strategies plateau on these questions because no single ranking can hold evidence from two filings at once. Cross-document recall@10 more than doubles against the baseline, and section questions reach 90.0% recall@10 with MRR 0.758.

Agentic retrieval costs 20–60s per question against roughly 7s for `hybrid+rerank`, since it makes several reranked retrievals plus two LLM calls. It is the default in the app; the eval harness runs any strategy with `--strategy=`.

Golden set v1: 29 labelled questions (6 single-fact, 7 numeric, 10 section, 6 cross-document), 49 labelled chunks.

`labelledBy: "model"` on the current golden set means the labels were machine-proposed, not human-confirmed. They were located largely through lexical and metadata-filtered search rather than the vector retriever being measured, which avoids grading the retriever against its own output, but two caveats follow: the label set is deliberately small (1–3 chunks per question), so recall is a **floor** rather than a true rate, and no human has yet confirmed that each labelled chunk genuinely answers its question. Run `npm run label -- --all` to review and extend.

## Architecture

```text
lib/ingest      EDGAR client, HTML parsing, section splitting, chunking, storage
lib/embed       embedder interface (Azure OpenAI today, swappable)
lib/retrieve    retrieval strategies behind one interface
lib/db.ts       Postgres client
scripts         preflight check, ingestion, migration and query CLIs
db/migrations   schema
```

Retrieval strategy is a config option, not a separate code path:

```ts
retrieve(query: string, opts: RetrieveOpts): Promise<Chunk[]>
```

| strategy | how it works |
| --- | --- |
| `vector` | pgvector cosine similarity over bge-small embeddings |
| `keyword` | Postgres full-text search, `websearch_to_tsquery` ranked by `ts_rank_cd` |
| `hybrid` | both lists fused by Reciprocal Rank Fusion (default) |

Fusion is rank-based — `1 / (60 + rank)` summed across lists — so no per-corpus score calibration is needed and the two retrievers' incomparable score scales never have to be reconciled. Metadata filters (`tickers`, `fiscalYears`, `sections`, `filingTypes`) apply to every strategy.

## EDGAR access

Requests are throttled to well under SEC's 10 requests/second limit, send an identifying User-Agent, retry with backoff on 429/5xx, and cache every response to disk.

Sources: [EDGAR developer resources](https://www.sec.gov/about/developer-resources), [pgvector](https://github.com/pgvector/pgvector), [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings).
