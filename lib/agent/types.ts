import type { RetrievalFilters } from "../retrieve";
import type { Chunk } from "../types";

export interface PlannedSearch {
  query: string;
  filters?: RetrievalFilters;
  purpose?: string;
}

export interface AgentStep {
  iteration: number;
  kind: "plan" | "search" | "assess";
  detail: string;
  query?: string;
  filters?: RetrievalFilters;
  results?: number;
  newResults?: number;
  elapsedMs: number;
}

export interface AgentTrace {
  question: string;
  steps: AgentStep[];
  searches: number;
  iterations: number;
  stoppedBecause: "sufficient" | "iteration-cap" | "no-progress" | "no-retrieval-needed" | "time-budget";
}

export interface AgentRetrieval {
  chunks: Chunk[];
  trace: AgentTrace;
}

export interface AgentOptions {
  k?: number;
  maxIterations?: number;
  maxSearches?: number;
  perSearchK?: number;
  budgetMs?: number;
}

export const AGENT_DEFAULTS = {
  k: 8,
  maxIterations: 3,
  maxSearches: 6,
  perSearchK: 10,
  budgetMs: 45_000,
};
