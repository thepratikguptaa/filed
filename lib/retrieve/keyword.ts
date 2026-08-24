import { db } from "../db";
import type { Chunk } from "../types";
import type { RetrievalFilters } from "./types";
import { rowToChunk, type ChunkRow } from "./vector";

function metadataClause(filters?: RetrievalFilters) {
  const sql = db();
  let clause = sql`true`;
  if (filters?.tickers?.length) clause = sql`${clause} and ticker = any(${filters.tickers})`;
  if (filters?.fiscalYears?.length) clause = sql`${clause} and fiscal_year = any(${filters.fiscalYears})`;
  if (filters?.sections?.length) clause = sql`${clause} and section = any(${filters.sections})`;
  if (filters?.filingTypes?.length) clause = sql`${clause} and filing_type = any(${filters.filingTypes})`;
  return clause;
}

export async function keywordSearch(
  query: string,
  k: number,
  filters?: RetrievalFilters,
): Promise<Chunk[]> {
  const sql = db();
  const rows = await sql<ChunkRow[]>`
    with q as (select websearch_to_tsquery('english', ${query}) as tsq)
    select
      id, document_id, company, ticker, filing_type, fiscal_year,
      section, section_title, position, text, token_count, has_table, content_hash,
      ts_rank_cd(search_vector, q.tsq) as score
    from chunks, q
    where search_vector @@ q.tsq and ${metadataClause(filters)}
    order by score desc
    limit ${k}
  `;
  return rows.map(rowToChunk).map((chunk, index) => ({ ...chunk, keywordRank: index + 1 }));
}
