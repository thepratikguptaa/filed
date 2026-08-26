import { withRetry } from "./db";

interface DocumentRow {
  ticker: string;
  company: string;
  fiscal_year: number;
}

function documents(): Promise<DocumentRow[]> {
  return withRetry((sql) => sql<DocumentRow[]>`
    select ticker, company, fiscal_year from documents order by ticker, fiscal_year
  `);
}

function groupByTicker(rows: DocumentRow[]) {
  const byTicker = new Map<string, { ticker: string; company: string; years: number[] }>();
  for (const row of rows) {
    const entry = byTicker.get(row.ticker) ?? { ticker: row.ticker, company: row.company, years: [] };
    entry.years.push(row.fiscal_year);
    byTicker.set(row.ticker, entry);
  }
  return [...byTicker.values()];
}

export interface CorpusStats {
  documents: number;
  chunks: number;
  companies: { ticker: string; company: string; years: number[] }[];
}

export async function getCorpusStats(): Promise<CorpusStats> {
  const [totals] = await withRetry((sql) => sql<{ documents: number; chunks: number }[]>`
    select
      (select count(*) from documents) as documents,
      (select count(*) from chunks) as chunks
  `);

  return {
    documents: Number(totals.documents),
    chunks: Number(totals.chunks),
    companies: groupByTicker(await documents()),
  };
}

export interface CorpusVocabulary {
  tickers: Set<string>;
  fiscalYears: Set<number>;
  sections: Set<string>;
}

let outline: Promise<string> | null = null;
let vocabulary: Promise<CorpusVocabulary> | null = null;

export function getCorpusOutline(): Promise<string> {
  if (!outline) {
    outline = (async () => {
      const rows = await documents();
      const sections = await withRetry((sql) => sql<{ section: string }[]>`
        select section from chunks
        where section is not null
        group by section having count(*) > 20
        order by section
      `);
      const lines = groupByTicker(rows).map(
        (entry) => `- ${entry.ticker} (${entry.company}): 10-K for FY${entry.years.join(", FY")}`,
      );
      return `${lines.join("\n")}\n\nSections available: ${sections.map((row) => row.section).join(", ")}`;
    })();
  }
  return outline;
}

export function getCorpusVocabulary(): Promise<CorpusVocabulary> {
  if (!vocabulary) {
    vocabulary = (async () => {
      const rows = await documents();
      const sections = await withRetry((sql) => sql<{ section: string }[]>`
        select section from chunks where section is not null group by section
      `);
      return {
        tickers: new Set(rows.map((row) => row.ticker)),
        fiscalYears: new Set(rows.map((row) => row.fiscal_year)),
        sections: new Set(sections.map((row) => row.section)),
      };
    })();
  }
  return vocabulary;
}
