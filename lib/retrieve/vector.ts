import { toVectorLiteral, withRetry } from "../db";
import { getEmbedder } from "../embed";
import type { Chunk } from "../types";
import { metadataClause } from "./filters";
import type { RetrievalFilters } from "./types";

export interface ChunkRow {
  id: string;
  document_id: string;
  company: string;
  ticker: string;
  filing_type: string;
  fiscal_year: number;
  section: string | null;
  section_title: string;
  position: number;
  text: string;
  token_count: number;
  has_table: boolean;
  content_hash: string;
  score: number;
}

export function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    documentId: row.document_id,
    company: row.company,
    ticker: row.ticker,
    filingType: row.filing_type as Chunk["filingType"],
    fiscalYear: row.fiscal_year,
    section: row.section,
    sectionTitle: row.section_title,
    position: row.position,
    text: row.text,
    tokenCount: row.token_count,
    hasTable: row.has_table,
    contentHash: row.content_hash,
    score: Number(row.score),
  };
}

export async function vectorSearch(query: string, k: number, filters?: RetrievalFilters): Promise<Chunk[]> {
  const [vector] = await getEmbedder().embed([query], "query");
  return vectorSearchByEmbedding(vector, k, filters);
}

async function vectorSearchByEmbedding(
  vector: number[],
  k: number,
  filters?: RetrievalFilters,
): Promise<Chunk[]> {
  const literal = toVectorLiteral(vector);
  const rows = await withRetry((sql) => sql<ChunkRow[]>`
    select
      id, document_id, company, ticker, filing_type, fiscal_year,
      section, section_title, position, text, token_count, has_table, content_hash,
      1 - (embedding <=> ${literal}::vector) as score
    from chunks
    where embedding is not null and ${metadataClause(sql, filters)}
    order by embedding <=> ${literal}::vector
    limit ${k}
  `);
  return rows.map(rowToChunk).map((chunk, index) => ({ ...chunk, vectorRank: index + 1 }));
}
