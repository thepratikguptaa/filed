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

## EDGAR access

Requests are throttled to well under SEC's 10 requests/second limit, send an identifying User-Agent, retry with backoff on 429/5xx, and cache every response to disk.

Sources: [EDGAR developer resources](https://www.sec.gov/about/developer-resources), [pgvector](https://github.com/pgvector/pgvector), [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings).
