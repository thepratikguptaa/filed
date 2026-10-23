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

import { COMPANY_NAME_MAP, getCompanyFullName, type CorpusStats } from "./companies";
export { COMPANY_NAME_MAP, getCompanyFullName, type CorpusStats } from "./companies";

const FALLBACK_COMPANIES = [
  { ticker: "AAPL", company: "Apple Inc.", years: [2024, 2025] },
  { ticker: "JPM", company: "JPMorgan Chase & Co.", years: [2024, 2025] },
  { ticker: "MSFT", company: "Microsoft Corporation", years: [2025, 2026] },
  { ticker: "PFE", company: "Pfizer Inc.", years: [2024, 2025] },
  { ticker: "XOM", company: "Exxon Mobil Corporation", years: [2024, 2025] },
];

function groupByTicker(rows: DocumentRow[]) {
  const byTicker = new Map<string, { ticker: string; company: string; years: number[] }>();
  for (const row of rows) {
    const companyName = getCompanyFullName(row.ticker, row.company);
    const entry = byTicker.get(row.ticker) ?? { ticker: row.ticker, company: companyName, years: [] };
    entry.years.push(row.fiscal_year);
    byTicker.set(row.ticker, entry);
  }
  return [...byTicker.values()];
}


export async function getCorpusStats(): Promise<CorpusStats> {
  try {
    const [totals] = await withRetry((sql) => sql<{ documents: number; chunks: number }[]>`
      select
        (select count(*) from documents) as documents,
        (select count(*) from chunks) as chunks
    `);

    return {
      documents: Number(totals?.documents ?? 0),
      chunks: Number(totals?.chunks ?? 0),
      companies: groupByTicker(await documents()),
    };
  } catch (error) {
    console.warn("Could not reach database for corpus stats, rendering with fallback stats:", (error as Error).message);
    return {
      documents: 10,
      chunks: 3981,
      companies: FALLBACK_COMPANIES,
    };
  }
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
