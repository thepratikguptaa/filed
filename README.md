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
