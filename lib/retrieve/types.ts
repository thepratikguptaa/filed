import type { Chunk } from "../types";

export type RetrievalStrategy = "vector" | "keyword" | "hybrid" | "hybrid+rerank";

export interface RetrievalFilters {
  tickers?: string[];
  fiscalYears?: number[];
  sections?: string[];
  filingTypes?: string[];
}

export interface RetrieveOpts {
  strategy?: RetrievalStrategy;
  k?: number;
  candidateK?: number;
  rrfK?: number;
  rerankN?: number;
  filters?: RetrievalFilters;
}

export interface Retriever {
  retrieve(query: string, opts?: RetrieveOpts): Promise<Chunk[]>;
}

export const DEFAULT_OPTS = {
  strategy: "hybrid+rerank" as RetrievalStrategy,
  k: 5,
  candidateK: 50,
  rrfK: 5,
  rerankN: 30,
};
