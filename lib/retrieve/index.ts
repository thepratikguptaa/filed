import type { Chunk } from "../types";
import { reciprocalRankFusion } from "./fuse";
import { keywordSearch } from "./keyword";
import { rerank } from "./rerank";
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
      return reciprocalRankFusion([dense, sparse], opts.rrfK ?? DEFAULT_OPTS.rrfK).slice(0, k);
    }

    case "hybrid+rerank": {
      const [dense, sparse] = await Promise.all([
        vectorSearch(query, candidateK, opts.filters),
        keywordSearch(query, candidateK, opts.filters),
      ]);
      const fused = reciprocalRankFusion([dense, sparse], opts.rrfK ?? DEFAULT_OPTS.rrfK);
      return rerank(query, fused.slice(0, opts.rerankN ?? DEFAULT_OPTS.rerankN), k);
    }

    case "agentic": {
      const { agenticRetrieve } = await import("../agent");
      const { chunks } = await agenticRetrieve(query, { k });
      return chunks;
    }

    default:
      throw new Error(`Retrieval strategy "${strategy}" is not implemented yet.`);
  }
}
