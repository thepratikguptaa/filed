# Filed

Agentic RAG over SEC filings, with source-backed citations and two evaluation harnesses.

A research tool. It surfaces cited evidence from public filings. It does not provide investment advice.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run check                # verifies env, database, embedding model and EDGAR access
npm run migrate
```

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection string, Session pooler on port 5432 |
| `EMBEDDING_PROVIDER` | `bge` (default, local), `nomic` (local, long context), or `azure` |
| `AZURE_OPENAI_ENDPOINT` | Resource root, e.g. `https://<resource>.openai.azure.com/` |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat deployment used by the answer layer |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Only when `EMBEDDING_PROVIDER=azure` |
| `SEC_USER_AGENT` | Identifies you to EDGAR, e.g. `Filed Research you@example.com` |
| `RERANK_MODEL` | Cross-encoder, defaults to `Xenova/ms-marco-MiniLM-L-6-v2` |
| `AGENT_BUDGET_MS` | Agent wall-clock budget, defaults to 45000 |
| `HNSW_EF_SEARCH` | pgvector search breadth, defaults to 400 |

Embeddings run behind the `Embedder` interface in [lib/embed](lib/embed); the default `bge-small-en-v1.5` runs locally in-process via transformers.js — no API key, no per-token cost, 384 dimensions. Each provider carries its own dimension, pooling and prefixes, and the active dimension must match the `vector(...)` column, so changing provider means a migration.

Chunk size derives from the embedder's context limit rather than being hardcoded, because bge truncates at 512 tokens. The document hash covers the raw filing, chunk config, parser version and embedder id, so changing any of them re-ingests automatically.

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
npm run query -- "how does Apple describe supply chain concentration risk?"
npm run query -- "net interest income" --ticker=JPM --year=2025 --k=10
npm run dev                           # http://localhost:3000
```

Raw filings are cached under `data/raw/`, so re-ingestion never re-downloads. Ingestion is idempotent: unchanged filings are skipped and chunk embeddings are reused by content hash.

## Asking questions

Question in, cited answer out, with the retrieved passages and scores beside it. Citation markers are interactive — hovering highlights the source, clicking scrolls to it.

`POST /api/ask` takes `{ question, strategy?, k? }` and returns the answer, ordered citations, retrieved chunks, and which chunk ids the model actually cited.

Answers are drafted and then passed through an attribution step that finds sentences carrying no citation and asks, in one further call, which sources state them. That call returns markers only — never prose — and each is range-checked before being inserted at a known character offset, so it can add attribution but cannot alter a figure or introduce a claim.

Grounding rules live in the system prompt in [lib/answer.ts](lib/answer.ts): answer only from the supplied sources, cite inline, quote figures exactly, name the company and fiscal year, read the column label before reporting a table figure, say plainly when the sources fall short, never phrase anything as advice. The LLM sits behind `LlmProvider` in [lib/llm](lib/llm), so swapping providers is one file.

## Evaluation

Two harnesses over the same 29-question golden set. **Retrieval eval** asks whether the right chunk was found. **Faithfulness eval** asks whether the answer is supported by the sources it cites. They fail independently — the system once shipped an answer that was fluent, correctly cited and factually wrong while every retrieval metric held steady.

```bash
npm run label                  # label unlabelled questions; --all revisits everything
npm run eval                   # retrieval metrics, appends eval/history.jsonl
npm run eval -- --strategy=vector --k=10 --no-history
npm run faithfulness           # generate answers, judge each claim against its cited sources
npm run faithfulness -- --strategy=agentic --limit=5
```

Each label stores the chunk id **and** a normalised text anchor. Chunk ids change whenever chunking or the parser changes — exactly the experiments the harness exists to run — so a chunk counts as relevant if its id matches *or* its text contains the anchor. Labels have survived four re-chunkings.

Two measurement details that materially changed the numbers:

- **Recall counts distinct labels covered, not matching chunks.** Chunks overlap, so one label can be matched twice; counting hits inflated 20 of 87 (question, k) pairs before this was fixed.
- **Vector search runs at `hnsw.ef_search = 400`**, which returns results identical to exact brute-force on all 29 queries. At the default, the approximate index returns a different top-k every time it is rebuilt — which is every re-ingest — worth about ±3.5 points of noise on any comparison spanning one.

The faithfulness judge sees one claim and *only the sources that claim cites*, and is told to check company, fiscal year, units and basis rather than the shape of a figure.

| metric | meaning |
| --- | --- |
| citation precision | of claims carrying a marker, the share their own cited sources support |
| grounded share | of all factual claims, the share carrying any marker at all |
| clean answers | answers containing no unsupported claim |

| file | contents |
| --- | --- |
| `eval/golden.json` | the labelled set, with `labelledBy` recording provenance |
| `eval/history.jsonl` | one line per retrieval run |
| `eval/faithfulness.jsonl` | one line per faithfulness run |
| `eval/faithfulness.latest.json` | full per-claim verdicts from the last run |

## Results

3,981 chunks, 400-token bodies, corrected recall metric, exact vector search:

| strategy | recall@3 | recall@5 | recall@10 | MRR | misses |
| --- | --- | --- | --- | --- | --- |
| keyword | 21.8% | 23.6% | 35.1% | 0.234 | 15 |
| vector | 32.8% | 40.8% | 48.9% | 0.390 | 11 |
| hybrid (RRF) | 32.2% | 37.4% | 54.0% | 0.423 | 9 |
| hybrid + rerank | 37.9% | 49.4% | 59.2% | 0.437 | 9 |
| **agentic** | **44.3%** | **58.0%** | **62.6%** | **0.579** | **7** |

"Misses" counts questions with no relevant chunk in the top 10, out of 29. Earlier configurations are in `eval/history.jsonl`, but those predate the two measurement fixes above and are not comparable to this table.

The agent leads every column, though by category the win is narrower than the total suggests:

| category | agentic recall@10 | hybrid + rerank | better |
| --- | --- | --- | --- |
| cross-document (6) | **50.0%** | 33.3% | agent |
| section (10) | **75.0%** | 65.0% | agent |
| single-fact (6) | 86.1% | **94.4%** | rerank |
| numeric (7) | 35.7% | **42.9%** | rerank |

It wins where a question needs more than one retrieval and loses where one well-ranked chunk was always going to hold the answer. On the cross-document subset every single-shot strategy is *flat* across depth — 25% at rank 3 and still 25% at rank 10 for vector and hybrid — because no single ranking can hold evidence from two filings at once. The agent is the only strategy where looking deeper finds anything.

Answer quality, `hybrid+rerank`, from `npm run faithfulness`:

| metric | value |
| --- | --- |
| citation precision | 94.2% |
| grounded share | 93.2% |
| clean answers | 23 / 29 |

148 claims judged: 130 supported, 10 uncited, 8 unsupported.

Agentic retrieval costs 20–45s per question against roughly 7s for `hybrid+rerank`, since it runs several reranked retrievals plus two LLM calls. It is the default in the app, but under Vercel's 60s request limit it frequently will not finish, which makes `hybrid+rerank` the realistic production path.

## What moved the numbers

**Hybrid fusion.** Rank-based RRF — `1/(k + rank)` summed across lists — needs no score calibration between two retrievers whose scales are incomparable. `rrfK` at 5/10/20/60 gives recall@10 of 44.8/43.7/38.5/42.0; `candidateK` at 15/30/50 gives 40.2/43.7/44.8, saturating at 50 because keyword search often returns fewer candidates than that. Both are tuned on 29 questions — reasonable defaults, not settled constants.

**The keyword half was broken on arrival.** `websearch_to_tsquery` ANDs every term, so a natural-language question needed a chunk containing all of them and keyword search returned nothing for 25 of 29 questions. It now tries strict AND first and fills remaining slots from an OR query, which took keyword recall@10 from 10.3% to 33.3%.

**Reranking buys shallow precision, not new results.** It reorders the fused top-N, so a relevant chunk at fused rank 25 can be pushed *out* of the top 10 — MiniLM's recall@10 sits slightly below unreranked hybrid while its recall@3 is far higher.

| reranker | params | ms/pair | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| ms-marco-MiniLM-L-6-v2 | 22M | 218 | 37.4% | 43.7% | 0.303 |
| bge-reranker-base | 278M | 1684 | **47.7%** | **54.6%** | **0.390** |

MiniLM is the default because it keeps an end-to-end answer near 10s. `RERANK_MODEL=Xenova/bge-reranker-base` is the better choice for offline eval or if ~50s per question is acceptable.

**Agentic decomposition and vocabulary rewriting.** *"How did JPMorgan's net interest income change from FY2024 to FY2025?"* becomes two filtered searches, one per year, putting the FY2025 figure at rank 2 where unreranked hybrid had it at rank 61. *"Capital expenditures"* becomes *"Additions to property and equipment"*, which is what Microsoft's cash flow statement actually says — retrieving a chunk no single-shot strategy could reach at depth 200. Caps are hard: 3 iterations, 6 searches, duplicates skipped, results interleaved so no single hop dominates. `perSearchK` matters more than it looks — at 5, a one-search question caps recall@10 at recall@5.

**Context headers.** A table of numbers in which the string "JPMorgan" never appears cannot match a question naming the company — the name, caption and units all live in blocks outside the chunk. Every chunk now carries company, ticker, fiscal year, filing type, section, and for tables the nearest caption. This lifted every single-shot strategy, plain vector search included.

**Attribution is a separate pass, not a prompt rule.** The model cited its first sentence and then stopped, leaving grounded share at 39.7%. Adding an explicit prompt rule that every factual sentence must carry a marker moved it to 36.8% — nowhere. Doing it structurally worked: after drafting, the uncited sentences are sent back with the sources in one call that returns markers only, never prose, and each marker is range-checked before being inserted at a known character offset. The model cannot rewrite a figure or add a claim in that pass, only attach attribution.

| | prompt rule | separate pass |
| --- | --- | --- |
| grounded share | 36.8% | **93.2%** |
| citation precision | 90.0% | **94.2%** |

Precision rising alongside coverage is the part worth trusting: attaching markers exposes each claim to a stricter test, since a claim with no marker is judged against every retrieved source while a cited one is judged against its own. Costs one extra LLM call per answer.

**One thing that did not work.** Composing multi-row table headers into self-describing column labels (`Standardized December 31, 2024`) bloated the header row that repeats on every split of a long table, cost retrieval accuracy, and broke the one question it targeted.

## Known limitations

**About one claim in eighteen is unsupported by the source it cites.** 8 of 148, and they are generation errors rather than retrieval or attribution errors: reporting a year-over-year *increase* as an absolute figure, taking a figure from the wrong column of a correctly retrieved table, or stretching a risk factor past what the filing says. The faithfulness harness names them per run in `eval/faithfulness.latest.json`.

**Table extraction fails silently.** Retrieval metrics cannot see a chunk that is found correctly and parsed wrongly. Cell alignment within a row is fixed, but which *column* a figure belongs to is still positional, and when column labels span two header rows nothing in the chunk states the mapping. The model now usually declines rather than guesses — a safer failure, still a failure. Check numeric answers against the linked filing.

**Numeric questions are the agent's weakest category** — 35.7% recall@10 against 42.9% for `hybrid+rerank`. Splitting a lookup into per-company, per-year searches spends budget on breadth when one filing held the answer. If your questions are mostly "what was X in year Y", use `hybrid+rerank`.

**Recall is understated, measurably.** Of the 9 questions where `hybrid+rerank` retrieved no labelled chunk in the top 10, **5 retrieved a chunk within two positions of a label** — the same financial table, one chunk over. q08 is the clearest: the label is chunk `#0160`, retrieval returned `#0161`, and `#0161` contains `Net interest income – reported | $95,443 | $92,583 | 89,267`, which is exactly what the question asks for. The system answers correctly and scores zero. **Recall@10 is understated by up to 17.2 points**, which is larger than most improvements recorded on this page.

The cause was the labelling tool, not the labels. Its candidate pool was vector-only, so a chunk unreachable by vector search — q08's is unreachable at depth 200 — could never be shown to a labeller. The pool now unions vector, keyword, and the position-neighbours of chunks already selected, which surfaces co-relevant chunks independently of the retriever being measured.

**The golden set is model-proposed and sparse.** 29 labelled questions, 56 labels, 1–3 each, `labelledBy: "model"`. Candidates were found by lexical and metadata-filtered search rather than by the vector retriever under test, so the set does not grade the retriever against its own output — but no human has confirmed each label, and the numbers above should be read with the understatement described here. Three further questions are unlabelled and excluded from every run. Run `npm run label -- --all` to review.

**Ten filings, five companies, two fiscal years.** These results do not predict behaviour on a corpus spanning more industries or older filing formats.

## Architecture

```text
lib/ingest      EDGAR client, HTML parsing, section splitting, chunking, storage
lib/embed       embedder interface, local or Azure
lib/retrieve    retrieval strategies behind one interface
lib/agent       plan / search / assess loop
lib/eval        golden set, retrieval metrics, faithfulness judge
db/migrations   schema
```

Retrieval strategy is a config option, not a separate code path:

```ts
retrieve(query: string, opts: RetrieveOpts): Promise<Chunk[]>
```

| strategy | how it works |
| --- | --- |
| `vector` | pgvector cosine similarity over bge-small embeddings |
| `keyword` | Postgres full-text search ranked by `ts_rank_cd`, AND then OR |
| `hybrid` | both lists fused by Reciprocal Rank Fusion |
| `hybrid+rerank` | fused top-30 rescored by a cross-encoder |
| `agentic` | LLM plans, filters and repeats searches until sufficient |

Metadata filters (`tickers`, `fiscalYears`, `sections`, `filingTypes`) apply to every strategy.

## EDGAR access

Requests are throttled well under SEC's 10 requests/second limit, send an identifying User-Agent, retry with backoff on 429/5xx, and cache every response to disk.

Sources: [EDGAR developer resources](https://www.sec.gov/about/developer-resources), [pgvector](https://github.com/pgvector/pgvector).
