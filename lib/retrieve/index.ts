import type { Chunk } from "../types";
import { DEFAULT_OPTS, type RetrieveOpts } from "./types";
import { vectorSearch } from "./vector";

export * from "./types";

export async function retrieve(query: string, opts: RetrieveOpts = {}): Promise<Chunk[]> {
  const strategy = opts.strategy ?? DEFAULT_OPTS.strategy;
  const k = opts.k ?? DEFAULT_OPTS.k;

  switch (strategy) {
    case "vector":
      return vectorSearch(query, k, opts.filters);
    default:
      throw new Error(`Retrieval strategy "${strategy}" is not implemented yet.`);
  }
}
