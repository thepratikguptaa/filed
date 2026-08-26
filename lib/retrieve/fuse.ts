import type { Chunk } from "../types";
import { DEFAULT_OPTS } from "./types";

export function reciprocalRankFusion(lists: Chunk[][], k = DEFAULT_OPTS.rrfK): Chunk[] {
  const merged = new Map<string, Chunk>();
  const scores = new Map<string, number>();

  for (const list of lists) {
    list.forEach((chunk, index) => {
      const rank = index + 1;
      const previous = merged.get(chunk.id);
      merged.set(chunk.id, {
        ...(previous ?? chunk),
        vectorRank: previous?.vectorRank ?? chunk.vectorRank,
        keywordRank: previous?.keywordRank ?? chunk.keywordRank,
      });
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (k + rank));
    });
  }

  return [...merged.values()]
    .map((chunk) => ({ ...chunk, score: scores.get(chunk.id) ?? 0 }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
