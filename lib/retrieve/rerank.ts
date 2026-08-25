import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env as hfEnv,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import { paths } from "../config";
import type { Chunk } from "../types";

hfEnv.cacheDir = paths.modelCache;

export const reranker = {
  model: process.env.RERANK_MODEL ?? "Xenova/ms-marco-MiniLM-L-6-v2",
  dtype: (process.env.RERANK_DTYPE ?? "q8") as "q8" | "fp32",
  batchSize: 8,
};

let loaded: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;

function load() {
  if (!loaded) {
    loaded = (async () => ({
      tokenizer: await AutoTokenizer.from_pretrained(reranker.model),
      model: await AutoModelForSequenceClassification.from_pretrained(reranker.model, {
        dtype: reranker.dtype,
      }),
    }))();
  }
  return loaded;
}

export async function rerank(query: string, chunks: Chunk[], k: number): Promise<Chunk[]> {
  if (chunks.length === 0) return [];

  const { tokenizer, model } = await load();
  const scores: number[] = [];

  for (let i = 0; i < chunks.length; i += reranker.batchSize) {
    const batch = chunks.slice(i, i + reranker.batchSize);
    const inputs = tokenizer(
      batch.map(() => query),
      { text_pair: batch.map((chunk) => chunk.text), padding: true, truncation: true },
    );
    const { logits } = await model(inputs);
    for (const row of logits.tolist() as number[][]) scores.push(row[0]);
  }

  return chunks
    .map((chunk, index) => ({ ...chunk, score: scores[index], fusedRank: index + 1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
