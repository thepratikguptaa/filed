import type { Chunk } from "../types";
import { reciprocalRankFusion } from "./fuse";
import { keywordSearch } from "./keyword";
import { DEFAULT_OPTS, type RetrieveOpts } from "./types";
import { vectorSearch } from "./vector";

export * from "./types";

export async function retrieve(query: string, opts: RetrieveOpts = {}): Promise<Chunk[]> {
  const strategy = opts.strategy ?? DEFAULT_OPTS.strategy;
  const k = opts.k ?? DEFAULT_OPTS.k;
  const candidateK = opts.candidateK ?? DEFAULT_OPTS.candidateK;

  switch (strategy) {
    case "vector":
      return vectorSearch(query, k, opts.filters);

    case "keyword":
      return keywordSearch(query, k, opts.filters);

    case "hybrid": {
      const [dense, sparse] = await Promise.all([
        vectorSearch(query, candidateK, opts.filters),
        keywordSearch(query, candidateK, opts.filters),
      ]);
      return reciprocalRankFusion([dense, sparse]).slice(0, k);
    }

    default:
      throw new Error(`Retrieval strategy "${strategy}" is not implemented yet.`);
  }
}
