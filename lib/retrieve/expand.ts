import { withRetry } from "../db";
import type { Chunk } from "../types";
import { rowToChunk, type ChunkRow } from "./vector";

/**
 * Expand retrieved chunks with positional neighbours from the same document.
 * When a neighbour continues a table that the retrieved chunk contains,
 * the neighbour text is concatenated so the answer layer sees the full table.
 *
 * This is a post-retrieval, pre-answer step — cheap (one SQL query) and
 * directly addresses "missed by one chunk" for wide tables.
 */
export async function expandWithNeighbours(chunks: Chunk[], maxExpanded?: number): Promise<Chunk[]> {
  if (chunks.length === 0) return [];

  const cap = maxExpanded ?? chunks.length + 4;
  const chunkIds = chunks.map((c) => c.id);
  const chunkSet = new Set(chunkIds);

  // Collect (document_id, position) pairs for neighbour lookup
  const keys = chunks.map((c) => ({ docId: c.documentId, pos: c.position }));
  const docIds = [...new Set(keys.map((k) => k.docId))];

  // Fetch all candidate neighbours in one query: same document, position ± 1
  const positions = keys.flatMap((k) => [k.pos - 1, k.pos, k.pos + 1]);
  const neighbours = await withRetry((sql) => sql<ChunkRow[]>`
    select
      id, document_id, company, ticker, filing_type, fiscal_year,
      section, section_title, position, text, token_count, has_table, content_hash,
      (select source_url from documents where id = chunks.document_id) as source_url,
      0 as score
    from chunks
    where document_id = any(${docIds})
      and position = any(${[...new Set(positions)]})
      and id != all(${chunkIds})
  `);

  const neighbourMap = new Map<string, Chunk>();
  for (const row of neighbours) {
    const key = `${row.document_id}:${row.position}`;
    neighbourMap.set(key, rowToChunk(row));
  }

  const result: Chunk[] = [];
  const added = new Set<string>();

  for (const chunk of chunks) {
    if (added.has(chunk.id)) continue;
    added.add(chunk.id);

    // Look for a preceding neighbour that continues into this chunk's table
    const prevKey = `${chunk.documentId}:${chunk.position - 1}`;
    const prev = neighbourMap.get(prevKey);
    if (prev && !added.has(prev.id) && !chunkSet.has(prev.id) && shouldMerge(prev, chunk)) {
      // Prepend neighbour context — mark it as an expansion
      result.push({ ...prev, score: chunk.score });
      added.add(prev.id);
    }

    result.push(chunk);

    // Look for a following neighbour that continues a table from this chunk
    const nextKey = `${chunk.documentId}:${chunk.position + 1}`;
    const next = neighbourMap.get(nextKey);
    if (next && !added.has(next.id) && !chunkSet.has(next.id) && shouldMerge(chunk, next)) {
      result.push({ ...next, score: chunk.score });
      added.add(next.id);
    }
  }

  return result.slice(0, cap);
}

/**
 * Two adjacent chunks should be merged when the first ends with a table
 * and the second starts with table-like content (pipe-separated rows),
 * indicating the table was split across chunks.
 */
function shouldMerge(before: Chunk, after: Chunk): boolean {
  // Only merge if they share the same section (same logical part of the filing)
  if (before.section !== after.section) return false;
  if (before.documentId !== after.documentId) return false;

  // At least one must contain a table
  if (!before.hasTable && !after.hasTable) return false;

  // Check if the text appears to continue a table across the boundary.
  // The chunk text starts with a header line, so look past it.
  const beforeLines = before.text.split("\n");
  const afterLines = after.text.split("\n");

  // Skip the context header (first non-empty line, then blank line)
  const afterBody = skipHeader(afterLines);
  const beforeBody = skipHeader(beforeLines);

  const beforeEndsTabular = beforeBody.length > 0 && beforeBody[beforeBody.length - 1].includes(" | ");
  const afterStartsTabular = afterBody.length > 0 && afterBody[0].includes(" | ");

  return beforeEndsTabular && afterStartsTabular;
}

function skipHeader(lines: string[]): string[] {
  // Context header format: "Company (TICKER) FYxxxx ... \n\n body"
  // Find the first blank line that separates the header from the body
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    if (lines[i].trim() === "") {
      start = i + 1;
      break;
    }
  }
  return lines.slice(start);
}
