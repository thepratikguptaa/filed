export type FilingType = "10-K" | "10-Q";

export interface FilingRef {
  accessionNumber: string;
  cik: string;
  company: string;
  ticker: string;
  filingType: FilingType;
  fiscalYear: number;
  periodEnd: string;
  filedDate: string;
  primaryDocument: string;
  sourceUrl: string;
}

export interface Block {
  kind: "text" | "table";
  text: string;
}

export interface Section {
  item: string | null;
  title: string;
  blocks: Block[];
}

export interface ParsedFiling {
  sections: Section[];
  contentHash: string;
}

export interface ChunkInput {
  id: string;
  documentId: string;
  company: string;
  ticker: string;
  filingType: FilingType;
  fiscalYear: number;
  section: string | null;
  sectionTitle: string;
  position: number;
  text: string;
  tokenCount: number;
  contentHash: string;
  hasTable: boolean;
}

export interface Chunk extends ChunkInput {
  score?: number;
  vectorRank?: number;
  keywordRank?: number;
}
