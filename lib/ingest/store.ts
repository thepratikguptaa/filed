import { db, toVectorLiteral, withRetry } from "../db";
import type { ChunkInput, FilingRef } from "../types";

export async function documentIsCurrent(documentId: string, contentHash: string): Promise<boolean> {
  const rows = await db()<{ content_hash: string; chunk_count: number }[]>`
    select content_hash, chunk_count from documents where id = ${documentId}
  `;
  return rows.length > 0 && rows[0].content_hash === contentHash && rows[0].chunk_count > 0;
}

export async function existingEmbeddings(hashes: string[]): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const rows = await db()<{ content_hash: string; embedding: string }[]>`
    select distinct on (content_hash) content_hash, embedding::text as embedding
    from chunks
    where content_hash in ${db()(hashes)} and embedding is not null
  `;
  return new Map(rows.map((row) => [row.content_hash, row.embedding]));
}

export async function persistFiling(
  filing: FilingRef,
  contentHash: string,
  chunks: ChunkInput[],
  vectors: string[],
): Promise<void> {
  const sql = db();
  const documentId = filing.accessionNumber.replace(/-/g, "");

  await withRetry(() => sql.begin(async (tx) => {
    await tx`
      insert into documents (
        id, cik, company, ticker, filing_type, fiscal_year,
        period_end, filed_date, source_url, content_hash, chunk_count
      ) values (
        ${documentId}, ${filing.cik}, ${filing.company}, ${filing.ticker}, ${filing.filingType},
        ${filing.fiscalYear}, ${filing.periodEnd}, ${filing.filedDate}, ${filing.sourceUrl},
        ${contentHash}, ${chunks.length}
      )
      on conflict (id) do update set
        content_hash = excluded.content_hash,
        chunk_count = excluded.chunk_count,
        source_url = excluded.source_url,
        ingested_at = now()
    `;
    await tx`delete from chunks where document_id = ${documentId}`;
    for (let i = 0; i < chunks.length; i += 200) {
      const slice = chunks.slice(i, i + 200);
      const rows = slice.map((chunk, offset) => ({
        id: chunk.id,
        document_id: chunk.documentId,
        company: chunk.company,
        ticker: chunk.ticker,
        filing_type: chunk.filingType,
        fiscal_year: chunk.fiscalYear,
        section: chunk.section,
        section_title: chunk.sectionTitle,
        position: chunk.position,
        text: chunk.text,
        token_count: chunk.tokenCount,
        has_table: chunk.hasTable,
        content_hash: chunk.contentHash,
        embedding: vectors[i + offset],
      }));
      await tx`insert into chunks ${tx(rows)}`;
    }
  }));
}

export function vectorLiteral(values: number[]): string {
  return toVectorLiteral(values);
}
