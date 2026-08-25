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

async function search(query: string, k: number, mode: "all" | "any", filters?: RetrievalFilters) {
  const sql = db();
  const tsquery =
    mode === "all"
      ? sql`nullif(plainto_tsquery('english', ${query})::text, '')::tsquery`
      : sql`nullif(replace(plainto_tsquery('english', ${query})::text, '&', '|'), '')::tsquery`;

  return sql<ChunkRow[]>`
    with q as (select ${tsquery} as tsq)
    select
      id, document_id, company, ticker, filing_type, fiscal_year,
      section, section_title, position, text, token_count, has_table, content_hash,
      ts_rank_cd(search_vector, q.tsq, 32) as score
    from chunks, q
    where search_vector @@ q.tsq and ${metadataClause(filters)}
    order by score desc
    limit ${k}
  `;
}

export async function keywordSearch(
  query: string,
  k: number,
  filters?: RetrievalFilters,
): Promise<Chunk[]> {
  const strict = await search(query, k, "all", filters);
  const rows = [...strict];

  if (rows.length < k) {
    const seen = new Set(rows.map((row) => row.id));
    const loose = await search(query, k, "any", filters);
    for (const row of loose) {
      if (rows.length >= k) break;
      if (!seen.has(row.id)) rows.push(row);
    }
  }

  return rows.map(rowToChunk).map((chunk, index) => ({ ...chunk, keywordRank: index + 1 }));
}
