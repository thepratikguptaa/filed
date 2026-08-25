import { db } from "./db";

export interface CorpusStats {
  documents: number;
  chunks: number;
  companies: { ticker: string; company: string; years: number[] }[];
}

export async function getCorpusStats(): Promise<CorpusStats> {
  const [totals] = await db()<{ documents: number; chunks: number }[]>`
    select
      (select count(*) from documents) as documents,
      (select count(*) from chunks) as chunks
  `;
  const rows = await db()<{ ticker: string; company: string; fiscal_year: number }[]>`
    select ticker, company, fiscal_year from documents order by ticker, fiscal_year
  `;

  const byTicker = new Map<string, { ticker: string; company: string; years: number[] }>();
  for (const row of rows) {
    const entry = byTicker.get(row.ticker) ?? { ticker: row.ticker, company: row.company, years: [] };
    entry.years.push(row.fiscal_year);
    byTicker.set(row.ticker, entry);
  }

  return {
    documents: Number(totals.documents),
    chunks: Number(totals.chunks),
    companies: [...byTicker.values()],
  };
}

export async function getCorpusOutline(): Promise<string> {
  const rows = await db()<{ ticker: string; company: string; fiscal_year: number }[]>`
    select ticker, company, fiscal_year from documents order by ticker, fiscal_year
  `;
  const sections = await db()<{ section: string | null }[]>`
    select section from chunks where section is not null group by section having count(*) > 20 order by section
  `;

  const byTicker = new Map<string, { company: string; years: number[] }>();
  for (const row of rows) {
    const entry = byTicker.get(row.ticker) ?? { company: row.company, years: [] };
    entry.years.push(row.fiscal_year);
    byTicker.set(row.ticker, entry);
  }

  const lines = [...byTicker.entries()].map(
    ([ticker, entry]) => `- ${ticker} (${entry.company}): 10-K for FY${entry.years.join(", FY")}`,
  );
  return `${lines.join("\n")}\n\nSections available: ${sections.map((row) => row.section).join(", ")}`;
}
