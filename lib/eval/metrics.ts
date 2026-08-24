import type { Chunk } from "../types";
import { isRelevant } from "./golden";
import type { GoldenQuestion, QuestionScore } from "./types";

export const K_VALUES = [3, 5, 10];

export function scoreQuestion(question: GoldenQuestion, retrieved: Chunk[]): QuestionScore {
  const hits = retrieved.map((chunk) => isRelevant(chunk, question.labels));
  const firstIndex = hits.indexOf(true);
  const total = question.labels.length;

  const recallAt: Record<number, number> = {};
  for (const k of K_VALUES) {
    const found = hits.slice(0, k).filter(Boolean).length;
    recallAt[k] = total === 0 ? 0 : Math.min(found, total) / total;
  }

  return {
    id: question.id,
    category: question.category,
    relevant: total,
    firstRelevantRank: firstIndex === -1 ? null : firstIndex + 1,
    recallAt,
    reciprocalRank: firstIndex === -1 ? 0 : 1 / (firstIndex + 1),
  };
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregate(scores: QuestionScore[]): { recallAt: Record<number, number>; mrr: number } {
  const recallAt: Record<number, number> = {};
  for (const k of K_VALUES) recallAt[k] = mean(scores.map((score) => score.recallAt[k]));
  return { recallAt, mrr: mean(scores.map((score) => score.reciprocalRank)) };
}
