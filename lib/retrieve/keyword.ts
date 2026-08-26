import { withRetry } from "../db";
import type { Chunk } from "../types";
import { metadataClause } from "./filters";
import type { RetrievalFilters } from "./types";
import { rowToChunk, type ChunkRow } from "./vector";

async function search(query: string, k: number, mode: "all" | "any", filters?: RetrievalFilters) {
  return withRetry((sql) => {
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
    where search_vector @@ q.tsq and ${metadataClause(sql, filters)}
    order by score desc
    limit ${k}
  `;
  });
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
    const loose = await search(query, k + rows.length, "any", filters);
    for (const row of loose) {
      if (rows.length >= k) break;
      if (!seen.has(row.id)) rows.push(row);
    }
  }

  return rows.map(rowToChunk).map((chunk, index) => ({ ...chunk, keywordRank: index + 1 }));
}
