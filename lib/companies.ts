export const COMPANY_NAME_MAP: Record<string, string> = {
  AAPL: "Apple Inc.",
  JPM: "JPMorgan Chase & Co.",
  MSFT: "Microsoft Corporation",
  PFE: "Pfizer Inc.",
  XOM: "Exxon Mobil Corporation",
};

export function getCompanyFullName(ticker?: string | null, fallbackName?: string | null): string {
  if (fallbackName && fallbackName.trim().length > 0) return fallbackName;
  if (!ticker) return "";
  return COMPANY_NAME_MAP[ticker.toUpperCase()] ?? ticker;
}

export interface CorpusStats {
  documents: number;
  chunks: number;
  companies: { ticker: string; company: string; years: number[] }[];
}
