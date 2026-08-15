import OpenAI from "openai";
import { embedding, env } from "../config";
import type { Embedder } from "./types";

export function openaiEmbedder(): Embedder {
  const client = new OpenAI({ apiKey: env.openaiApiKey });

  return {
    id: embedding.model,
    dimensions: embedding.dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const vectors: number[][] = [];

      for (let i = 0; i < texts.length; i += embedding.batchSize) {
        const batch = texts.slice(i, i + embedding.batchSize);
        const response = await client.embeddings.create({
          model: embedding.model,
          input: batch,
          encoding_format: "float",
        });
        const ordered = [...response.data].sort((a, b) => a.index - b.index);
        vectors.push(...ordered.map((item) => item.embedding));
      }
      return vectors;
    },
  };
}
