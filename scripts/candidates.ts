import { closeDb, db } from "../lib/db";
import { loadDraft } from "../lib/eval/golden";
import { vectorSearch } from "../lib/retrieve/vector";
import type { Chunk } from "../lib/types";

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

interface Row {
  id: string; document_id: string; company: string; ticker: string; filing_type: string;
  fiscal_year: number; section: string | null; section_title: string; position: number;
  text: string; token_count: number; has_table: boolean; content_hash: string; score: number;
}

async function lexical(query: string, hint: { tickers?: string[]; fiscalYears?: number[] } | undefined, k: number) {
  const sql = db();
  const rows = await sql<Row[]>`
    select id, document_id, company, ticker, filing_type, fiscal_year, section, section_title,
           position, text, token_count, has_table, content_hash,
           ts_rank(to_tsvector('english', text), websearch_to_tsquery('english', ${query})) as score
    from chunks
    where to_tsvector('english', text) @@ websearch_to_tsquery('english', ${query})
      ${hint?.tickers?.length ? sql`and ticker = any(${hint.tickers})` : sql``}
      ${hint?.fiscalYears?.length ? sql`and fiscal_year = any(${hint.fiscalYears})` : sql``}
    order by score desc
    limit ${k}
  `;
  return rows.map((row) => ({ ...row, documentId: row.document_id, score: Number(row.score) })) as unknown as Chunk[];
}

async function main() {
  const from = Number(flag("from") ?? 1);
  const to = Number(flag("to") ?? 99);
  const draft = await loadDraft();

  for (const question of draft) {
    const index = Number(question.id.replace("q", ""));
    if (index < from || index > to) continue;

    const seen = new Map<string, { chunk: Chunk; sources: string[] }>();
    const add = (chunks: Chunk[], source: string) => {
      for (const chunk of chunks) {
        const entry = seen.get(chunk.id) ?? { chunk, sources: [] };
        entry.sources.push(source);
        seen.set(chunk.id, entry);
      }
    };

    add(await vectorSearch(question.question, 8), "vec");
    if (question.hint) {
      add(await vectorSearch(question.question, 8, {
        tickers: question.hint.tickers,
        fiscalYears: question.hint.fiscalYears,
        sections: question.hint.sections,
      }), "vec+filter");
    }
    try {
      add(await lexical(question.question, question.hint, 8), "lex");
    } catch {
      // websearch_to_tsquery rejects some phrasings; vector candidates still stand
    }

    console.log(`\n${"#".repeat(100)}`);
    console.log(`${question.id} [${question.category}] ${question.question}`);
    console.log(`hint: ${JSON.stringify(question.hint ?? {})}`);
    for (const { chunk, sources } of seen.values()) {
      console.log(`\n--- ${chunk.id} | ${chunk.ticker} FY${chunk.fiscalYear} | ${chunk.section ?? "-"} | ${sources.join(",")}`);
      console.log(chunk.text.replace(/\s+/g, " ").slice(0, 420));
    }
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
