export type QuestionCategory = "single-fact" | "numeric" | "section" | "cross-document";

export interface Label {
  chunkId: string;
  documentId: string;
  section: string | null;
  anchor: string;
}

export interface GoldenQuestion {
  id: string;
  question: string;
  category: QuestionCategory;
  hint?: { tickers?: string[]; fiscalYears?: number[]; sections?: string[] };
  labels: Label[];
  labelledAt?: string;
}

export interface GoldenSet {
  version: number;
  embedder: string;
  labelledBy?: LabelSource;
  questions: GoldenQuestion[];
}

export interface QuestionScore {
  id: string;
  category: QuestionCategory;
  relevant: number;
  firstRelevantRank: number | null;
  recallAt: Record<number, number>;
  reciprocalRank: number;
}

export interface EvalConfig {
  strategy: string;
  k: number;
  candidateK: number;
  rrfK: number;
  rerankN: number;
  embedder: string;
  reranker: string;
}

export interface EvalReport {
  ranAt: string;
  strategy: string;
  config: EvalConfig;
  candidateK?: number;
  k: number;
  goldenVersion: number;
  questions: number;
  overall: { recallAt: Record<number, number>; mrr: number };
  byCategory: Record<string, { questions: number; recallAt: Record<number, number>; mrr: number }>;
  scores: QuestionScore[];
}

export type LabelSource = "human" | "model";
