export interface CorpusCompany {
  ticker: string;
  cik: string;
  name: string;
  sector: string;
}

export const CORPUS: CorpusCompany[] = [
  { ticker: "AAPL", cik: "0000320193", name: "Apple Inc.", sector: "Technology" },
  { ticker: "MSFT", cik: "0000789019", name: "Microsoft Corporation", sector: "Technology" },
  { ticker: "JPM", cik: "0000019617", name: "JPMorgan Chase & Co.", sector: "Financials" },
  { ticker: "XOM", cik: "0000034088", name: "Exxon Mobil Corporation", sector: "Energy" },
  { ticker: "PFE", cik: "0000078003", name: "Pfizer Inc.", sector: "Healthcare" },
];

export const YEARS_PER_COMPANY = 2;
