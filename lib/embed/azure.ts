import { AzureOpenAI } from "openai";
import { embedding, env } from "../config";
import type { Embedder } from "./types";

export function azureEmbedder(): Embedder {
  const deployment = env.azureEmbeddingDeployment;
  const client = new AzureOpenAI({
    endpoint: env.azureEndpoint,
    apiKey: env.azureApiKey,
    apiVersion: env.azureApiVersion,
    deployment,
  });

  return {
    id: `azure:${deployment}`,
    dimensions: embedding.dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const vectors: number[][] = [];

      for (let i = 0; i < texts.length; i += embedding.batchSize) {
        const batch = texts.slice(i, i + embedding.batchSize);
        const response = await client.embeddings.create({
          model: deployment,
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
