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
| `EMBEDDING_PROVIDER` | `bge` (default, local), `nomic` (local, long context), or `azure` |
| `AZURE_OPENAI_ENDPOINT` | Resource root, e.g. `https://<resource>.openai.azure.com/` — deployment paths are added by the client |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Chat deployment used by the answer layer |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Only needed when `EMBEDDING_PROVIDER=azure` |
| `SEC_USER_AGENT` | Identifies you to EDGAR, e.g. `Filed Research you@example.com` |
| `RERANK_MODEL` | Cross-encoder, defaults to `Xenova/ms-marco-MiniLM-L-6-v2` |
| `AGENT_BUDGET_MS` | Agent wall-clock budget, defaults to 45000 |

Embeddings run through the `Embedder` interface in [lib/embed](lib/embed). The default is `bge-small-en-v1.5` running locally in-process via transformers.js — no API key, no per-token cost, 384 dimensions. Each provider carries its own dimension, pooling method and query/document prefixes, and the active provider's dimension must match the `vector(...)` column in the schema; changing provider means a migration.

Chunk size is derived from the embedder's context limit rather than hardcoded, because bge truncates at 512 tokens. Switching provider automatically re-chunks: the document hash covers the raw filing, the chunk config, the parser version and the embedder id, so any of those changing invalidates a filing and re-ingests it.

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

Two harnesses run over the same golden set. **Retrieval eval** asks whether the right chunk was found; **faithfulness eval** asks whether the generated answer is supported by the sources it cites. They fail independently — M7 shipped an answer that was fluent, correctly cited and factually wrong while every retrieval metric held steady.

The labeller proposes candidate chunks by retrieval and a person decides which ones genuinely answer each question. The set currently in `eval/golden.json` carries `labelledBy: "model"`; see the note at the end of this section.

```bash
npm run label                  # label every unlabelled question
npm run label -- --id=q08      # revisit one question
npm run label -- --all         # revisit everything, including labelled
npm run eval                   # run the golden set, print metrics, append history
npm run eval -- --strategy=vector --k=10 --no-history
npm run faithfulness           # generate answers, judge every claim against its cited sources
npm run faithfulness -- --strategy=agentic --limit=5 --no-history
```

In the labeller: type candidate numbers to toggle them, `m` for more candidates, `s` to save and move on, `k` to skip, `q` to quit. Progress is written to `eval/golden.json` after every save.

Each label stores the chunk id **and** a normalised text anchor from that chunk. Chunk ids change whenever chunk size or the parser changes, so id-only labels would be invalidated by exactly the experiments the harness exists to run. A chunk counts as relevant if its id matches or its text contains the anchor, which keeps labels usable across re-chunking.

Retrieval metrics are recall@3, recall@5, recall@10 and MRR, reported overall and per category. No LLM is involved. Every run appends a summary to `eval/history.jsonl` so deltas across milestones stay visible.

Recall counts **distinct labels covered**, not retrieved chunks that matched. Chunks overlap, so one label can be matched twice; counting hits instead of labels overstates recall (M8).

Vector search runs with `hnsw.ef_search = 400`, which returns results identical to exact brute-force on all 29 golden queries. At the default setting the approximate index returns a different top-k each time it is rebuilt, which is a re-ingest, which is every experiment this harness exists to run (M10).

Faithfulness metrics come from an LLM judge that sees one claim and only the sources that claim cites:

| metric | meaning |
| --- | --- |
| citation precision | of the claims that carry a marker, the share their own cited sources actually support |
| grounded share | of all factual claims, the share carrying any citation marker at all |
| clean answers | answers containing no unsupported claim |

The judge is told the sources are its only knowledge and to check company, fiscal year, units and basis rather than the shape of a figure — sources from different filings look nearly identical, which is how a wrong-column figure passes a casual read.

| file | contents |
| --- | --- |
| `eval/questions.draft.json` | proposed questions, no labels |
| `eval/proposed-labels.json` | question id to chunk id mapping, applied by `npm run apply-labels` |
| `eval/golden.json` | the labelled golden set, with `labelledBy` recording its provenance |
| `eval/history.jsonl` | one line per retrieval eval run |
| `eval/faithfulness.jsonl` | one line per faithfulness run |
| `eval/faithfulness.latest.json` | full per-claim verdicts from the most recent run |

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

### M6 — table-aware chunking

Financial tables were the weakest category, so the fix targeted why. Inspecting the chunk holding JPMorgan's CET1 ratio showed the problem plainly: a well-formed table of numbers in which the string "JPMorgan" never appears. The company name, the table caption and the units all live in blocks *outside* the chunk, so a bare grid of figures cannot match a question that names the company.

Every chunk now carries a context header — company, ticker, fiscal year, filing type, section, and for table chunks the nearest preceding caption. The header is budgeted at 48 tokens and counted against the model's 512-token limit, so the body shrinks to make room.

| strategy | headers | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| hybrid + rerank | no | 28.7% | 37.4% | 43.7% | 0.303 |
| hybrid + rerank | **yes** | **39.7%** | **49.4%** | **64.4%** | **0.399** |
| agentic | no | 37.9% | 58.0% | **72.4%** | **0.518** |
| agentic | **yes** | **41.4%** | 54.6% | 62.6% | 0.453 |

The result is genuinely split. Headers are a large win for single-shot retrieval — recall@10 **+20.7pts**, and numeric questions went 35.7% to **71.4%**, which was the hypothesis. They are a loss for the agent: **−9.8pts** recall@10 and −0.065 MRR, with only recall@3 improving.

The likely reason is redundancy. The agent already supplies company and year through metadata filters, so the header repeats information it does not need, while still paying the cost. That cost is the confound in this experiment: headers did not only add context, they also cut the body budget from 400 to 352 tokens and pushed the corpus from 3,976 to 4,603 chunks. Each retrieved chunk therefore carries less filing text, and a fixed k covers less material. Separating the two effects needs a third ingest that keeps the header and restores the body, which is what M7 does.

Which configuration is best depends on the strategy you can actually deploy. Under Vercel's 60s request limit the agent frequently will not finish, making `hybrid+rerank` the realistic production path — and there headers are decisively better.

### M7 — column alignment and body budget

Two defects surfaced together, both visible in the same chunk.

**Misaligned table columns.** Asked for JPMorgan's 2025 CET1 ratio, the app answered *"14.6% under the Standardized approach and 15.7% under the Advanced approach"*. The first figure is right; the second is the FY2024 Standardized ratio, read off the wrong column. The cause is in extraction, not retrieval: `%` signs and footnote markers like `(c)` occupy their own `<td>` cells, so a six-column row arrives as thirteen cells and column position stops meaning anything.

```
before  CET1 capital ratio | 14.6 | % | (c) | 15.7 | % | 11.5 | % | 14.1 | % | (c) | 15.8 | % | 11.5 | %
after   CET1 capital ratio(c) | 14.6% | 15.3% | 14.1% | 15.8%
```

Cells matching a small adornment set are now folded into the neighbour they belong to before the row is rendered. The same question now answers 14.6% Standardized and 14.1% Advanced, matching the filing. This is the more serious of the two defects: a retrieval miss produces a visible "not found", but a misparsed table produces a confident, well-cited, wrong number.

**The header budget was charged twice.** M6 shrank chunk bodies from 400 to 352 tokens to make room for the 48-token header. That was unnecessary — the header is counted inside the 500-token limit already, so bodies never needed to give anything up. Restoring them to 400 tokens undoes the confound M6 flagged.

| strategy | body | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| hybrid + rerank | 352 | 39.7% | 49.4% | 64.4% | 0.399 |
| hybrid + rerank | **400** | **44.8%** | 49.4% | **66.1%** | **0.436** |
| agentic | 352 | 41.4% | 54.6% | 62.6% | 0.453 |
| agentic | **400** | **47.7%** | **56.3%** | **67.8%** | **0.606** |

Both rows of each pair were measured with the recall metric as it stood at the time. M8 found that metric to be wrong and restates the absolute numbers; the comparison here still holds, because the same bug applies to both sides.

This answers M6's open question. The agent's 9.8pt loss was mostly the shortened body, not the header: half of it comes back (62.6% → 67.8%) with the header still in place, and MRR goes to 0.606, the highest any configuration has recorded. Agentic now leads `hybrid+rerank` on every metric, which it did not before. Fewer, fuller chunks also mean the corpus shrank from 4,603 to 3,981 while holding the same text.

A residual 4.6pt gap to the header-free 72.4% remains, but that measurement predates the column fix and so is not a clean comparison; isolating what is left would cost another full re-embed for a difference smaller than the noise of a 29-question set.

Numeric questions are the one category that did not benefit: 35.7% recall@10 for the agent against 42.9% for `hybrid+rerank`. The agent decomposes a numeric question into per-company, per-year searches and then interleaves the results, which spends its budget on breadth when a single filing held the answer.

### M8 — the recall metric was wrong

A review of the eval harness found that `scoreQuestion` counted **retrieved chunks that matched a label**, not **distinct labels covered**:

```ts
const found = hits.slice(0, k).filter(Boolean).length   // chunks, not labels
recallAt[k] = Math.min(found, total) / total
```

Chunks overlap by 60 tokens, so two adjacent chunks can both match the same golden anchor. When that happened the label was counted twice and `Math.min` capped the result at full coverage — a question with two labels, one of them found twice, scored 100% instead of 50%. Across the 29-question set this inflated **20 (question, k) pairs**, q19@3 and q22@3 among them. Recall now counts labels:

```ts
const covered = question.labels.filter((label) => top.some((chunk) => isRelevant(chunk, [label]))).length
recallAt[k] = covered / total
```

MRR was never affected — it depends only on the rank of the first hit.

| strategy | recall@10 as reported | recall@10 corrected |
| --- | --- | --- |
| vector | 55.7% | 48.9% |
| hybrid | 52.9% | 50.6% |
| hybrid + rerank | 66.1% | 59.2% |
| agentic | 67.8% | 59.2% |

Every recall figure published before this point was overstated by roughly 2–9 points, this file included. Ordering between strategies is unchanged, so the conclusions drawn from those numbers still stand, but the M1–M7 tables below are left as they were recorded and are not comparable to anything measured after this fix.

Four other defects came out of the same review, none of which any metric would have caught:

- **The reranker read the wrong logit.** `logits[0]` is the relevance score for a single-output cross-encoder, which is what ships by default — but `RERANK_MODEL` is configurable, and a two-output model puts relevance in the second slot. Pointing the env var at one would have sorted results by *irrelevance* with no error anywhere.
- **The keyword OR-fallback could return short.** It requested exactly `k` rows, then dropped those already present from the strict AND pass, so a query whose two passes overlapped ended up with fewer than `k` candidates entering fusion.
- **`lib/corpus.ts` bypassed the connection-retry wrapper.** Every other query path had been moved onto `withRetry` after the ECONNRESET failures during long eval runs; the three corpus queries — which every agentic question calls — were missed.
- **The answer prompt sent metadata twice.** Chunks carry their own context header (M6), and the source renderer prepended a second copy of company, ticker, year and section to all eight sources.

### M9 — measuring the answer, not just the retrieval

M7 shipped a wrong number that every retrieval metric approved of. The chunk was found, ranked first, and cited — and the figure in it was read out of the wrong column. Nothing in the harness could see that, so the harness was the thing missing.

`npm run faithfulness` generates an answer for each golden question, splits it into sentences, and judges each sentence against **only the sources that sentence cites**. Restricting the judge to the cited sources is what makes citation precision meaningful: a claim that is true, and supported somewhere in the retrieved set, still fails if the marker points at a source that does not contain it.

First run, `hybrid+rerank`, 116 claims over 29 questions:

| metric | value |
| --- | --- |
| citation precision | 91.3% |
| **grounded share** | **39.7%** |
| clean answers | 25 / 29 |

The headline finding was not the one being looked for. **Three of every five factual claims carried no citation at all** — and the judge confirmed the sources supported them. The model cites its first sentence and then stops. q11 is typical: sentence one cites S4 for Pfizer's 2024 R&D expense, sentence two gives the 2023 and 2022 figures from the same table with no marker. Answers *look* well-cited because the first sentence always is.

The four unsupported claims were the errors worth having: the M7 CET1 column again, a true statement about Exxon's auditor citing two sources that do not name the firm, and two claims reporting Microsoft's FY2026 capital expenditure *increase* as though it were the absolute figure.

### M10 — two failed experiments and a broken instrument

Both fixes aimed at M9's findings failed, and chasing why exposed something worse.

**Flattening stacked table headers made things worse.** The CET1 row parses correctly after M7 but its columns are labelled two rows up, alternating basis and legal entity. Composing those rows into self-describing labels — `Standardized December 31, 2024`, `Advanced JPMorgan Chase Bank, N.A.` — should have removed the ambiguity. It changed 92 of 1,385 tables, lost none, and every sample looked like an improvement. It also dropped `hybrid+rerank` to 52.3% recall@10, and broke the one question it was built for: q03 fell out of the top 10 entirely and the answer degraded from wrong-but-coherent to self-contradictory. The composite labels bloat the header row, which is repeated on every split of a long table, diluting the chunk's signal. Reverted.

**Telling the model to cite harder did nothing.** The prompt gained an explicit rule that every factual sentence carries a marker. Grounded share went 39.7% → 36.8%. Undercitation is not a prompt-compliance problem and will not be fixed by asking again; catching it needs a structural pass over the generated answer.

**The instrument itself was unreliable.** Reverting the flattening rebuilt a corpus byte-identical to the earlier one — same 3,981 chunks, same 1,377,878 tokens. It scored **55.7%** where the original had scored **59.2%**, and re-running reproduced 55.7% exactly, so this was not run-to-run randomness.

The variable was the HNSW index. Every re-ingest deletes and reinserts every row, rebuilding the graph, and HNSW is *approximate*: the same vectors return a different top-k depending on how the graph was built. That is roughly **±3.5 points of noise on any comparison spanning a re-ingest** — which is every experiment in M6, M7 and M10. Several deltas reported in those sections were smaller than the noise they were measured through, including the "−6.9pts" first attributed to flattening.

Vector search now sets `hnsw.ef_search = 400`, verified against brute-force with `enable_indexscan` off: **all 29 golden queries return results identical to exact search** at k=50. The index is no longer a variable.

The one thing that did improve came free. q03 no longer answers 15.8%; it says the sources do not give JPMorgan's CET1 ratio for December 31 2025. That is still a failure — the ratio is in the corpus — but a stated absence is a far better failure than a confident wrong figure.

### Results summary

**The current numbers**, on 3,981 chunks with 400-token bodies, corrected recall (M8) and exact vector search (M10):

| strategy | recall@3 | recall@5 | recall@10 | MRR | misses |
| --- | --- | --- | --- | --- | --- |
| keyword | 21.8% | 23.6% | 35.1% | 0.234 | 15 |
| vector | 32.8% | 40.8% | 48.9% | 0.390 | 11 |
| hybrid (RRF) | 32.2% | 37.4% | 54.0% | 0.423 | 9 |
| hybrid + rerank | 37.9% | 49.4% | 59.2% | 0.437 | 9 |
| **agentic** | **44.3%** | **58.0%** | **62.6%** | **0.579** | **7** |

"Misses" counts questions with no relevant chunk in the top 10, out of 29. These are the only figures on this page measured with both a correct metric and a stable index, and the only ones to quote.

The agent leads every column of that table, and by category the win is narrower than the total suggests:

| category | agentic recall@10 | hybrid + rerank | better |
| --- | --- | --- | --- |
| cross-document (6) | **50.0%** | 33.3% | agent |
| section (10) | **75.0%** | 65.0% | agent |
| single-fact (6) | 86.1% | **94.4%** | rerank |
| numeric (7) | 35.7% | **42.9%** | rerank |

The agent wins where a question needs more than one retrieval — spanning filings, or covering a whole section — and loses where one well-ranked chunk was always going to hold the answer. Splitting a lookup into per-company, per-year searches spends budget on breadth that a single ranked list would have spent on depth.

Answer quality on the same corpus, `hybrid+rerank`, from `npm run faithfulness`:

| metric | value |
| --- | --- |
| citation precision | 90.0% |
| grounded share | 36.8% |
| clean answers | 24 / 29 |

Read those together: the citations that exist are reliable, and most of the answer carries none.

Everything below this line was measured before M8 and M10, through a recall metric that overstated coverage and an index that shifted on every rebuild. It is kept as the record of how the system got here, not as evidence. Do not compare it against the table above or against itself across corpora.

Contextual headers changed the corpus itself, so results are grouped by the corpus they were measured on.

**Without contextual headers** (3,976 chunks, 400-token bodies — pre-M8 metric):

| milestone | strategy | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| M1 | vector | 17.2% | 25.3% | 35.1% | 0.235 |
| M3 | hybrid (RRF) | 19.0% | 25.3% | 44.8% | 0.304 |
| M4 | hybrid + MiniLM rerank | 28.7% | 37.4% | 43.7% | 0.303 |
| M4 | hybrid + bge rerank | 27.6% | 47.7% | 54.6% | 0.390 |
| M5 | agentic | 37.9% | 58.0% | 72.4% | 0.518 |

**With contextual headers, shortened bodies** (4,603 chunks, 352-token bodies — pre-M8 metric):

| milestone | strategy | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- | --- |
| M6 | vector | 23.0% | 35.6% | 50.6% | 0.330 |
| M6 | hybrid (RRF) | 31.0% | 41.4% | 52.9% | 0.393 |
| M6 | hybrid + MiniLM rerank | 39.7% | 49.4% | **64.4%** | 0.399 |
| M6 | agentic | **41.4%** | 54.6% | 62.6% | **0.453** |

Headers lift every single-shot strategy including plain vector search, and the agent's apparent aversion to them turned out to be an artefact of the shortened bodies that shipped alongside them.

Two sources of variance are worth keeping in mind when reading any of it. Agentic scores move between identical runs because the plan comes from an LLM — observed spread about 0.05 MRR. Everything else is deterministic within a build but was not stable across rebuilds until M10.

Cross-document subset on the current corpus, which is what the agent exists for:

| strategy | recall@3 | recall@5 | recall@10 | MRR |
| --- | --- | --- | --- | --- |
| keyword | 16.7% | 16.7% | 25.0% | 0.074 |
| vector | 25.0% | 25.0% | 25.0% | 0.250 |
| hybrid | 25.0% | 25.0% | 25.0% | 0.222 |
| hybrid + rerank | 33.3% | 33.3% | 33.3% | 0.333 |
| **agentic** | **41.7%** | **50.0%** | **50.0%** | **0.458** |

Every single-shot strategy is flat across depth here — 25% at rank 3 and still 25% at rank 10 for vector and hybrid. No single ranking can hold evidence from two filings at once, so looking deeper finds nothing new. The agent is the only strategy where depth buys anything, and it doubles vector search at recall@10.

Agentic retrieval costs 20–45s per question against roughly 7s for `hybrid+rerank`, since it makes several reranked retrievals plus two LLM calls. It is the default in the app; the eval harness runs any strategy with `--strategy=`.

The agent stops at a wall-clock budget (`AGENT_BUDGET_MS`, 45s by default) as well as at its iteration and search caps, because Vercel's free tier kills a request at 60s. That budget costs cross-document recall — before it existed the same code scored 58.3% recall@10 on that subset instead of 41.7%, since multi-hop questions are exactly the ones that run long. Raising `AGENT_BUDGET_MS` recovers it wherever the 60s limit does not apply.

Every eval run records the full configuration it ran under — strategy, k, candidateK, rrfK, rerankN, embedder and reranker — so two runs of the same strategy under different settings stay distinguishable in `eval/history.jsonl`.

Golden set v1: 29 labelled questions (6 single-fact, 7 numeric, 10 section, 6 cross-document), 49 labelled chunks.

`labelledBy: "model"` on the current golden set means the labels were machine-proposed, not human-confirmed. They were located largely through lexical and metadata-filtered search rather than the vector retriever being measured, which avoids grading the retriever against its own output, but two caveats follow: the label set is deliberately small (1–3 chunks per question), so recall is a **floor** rather than a true rate, and no human has yet confirmed that each labelled chunk genuinely answers its question. Run `npm run label -- --all` to review and extend.

### Known limitations

**Most factual claims are uncited.** Grounded share is 36.8%: nearly two thirds of the factual sentences in a generated answer carry no citation marker, even though the evidence for them is in the retrieved set. Of the claims that *are* cited, 90.0% are supported by their own sources. So the citations that exist are trustworthy and most of the answer simply has none. A reader checking a specific sentence will frequently find nothing to check. Asking the model to cite more did not help (M10); fixing it needs a pass that detects uncited factual sentences and forces attribution.

**Multi-row table headers are still unresolved.** M7 fixed cell alignment within a row. Which *column* a figure belongs to is still positional, and when the column labels span two header rows — basis over entity, or basis over year — nothing in the chunk states the mapping. The attempt to compose those labels cost more retrieval accuracy than it returned (M10). Today the model usually declines rather than guesses, which is the safer failure but still a failure.

**Table extraction fails silently.** Retrieval metrics cannot see a chunk that is found correctly and parsed wrongly — the M7 column bug produced a fluent, correctly cited, factually wrong figure while every retrieval number held steady. Only the faithfulness harness catches this class, and only when the judge notices. Merged cells, multi-row headers and nested tables are best-effort; check a numeric answer against the linked filing before relying on it.

**Numeric questions are the agent's weakest category** — 35.7% recall@10 against 42.9% for `hybrid+rerank`, one of two categories where the agent loses (the other is single-fact, 86.1% against 94.4%). Decomposing a numeric question into per-company, per-year searches spends the search budget on breadth when a single filing held the answer, and the per-search `k` of 10 then caps how deep any one of them can look. If your questions are mostly "what was X in year Y", `hybrid+rerank` is the better retriever.

**Ten filings, five companies, two fiscal years.** Results here do not predict behaviour on a corpus that spans more industries or older filing formats.

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
