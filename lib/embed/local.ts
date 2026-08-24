import { env as hfEnv, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { embedding, paths } from "../config";
import type { EmbedKind, Embedder } from "./types";

hfEnv.cacheDir = paths.modelCache;

const DTYPE = (process.env.EMBEDDING_DTYPE ?? "q8") as "q8" | "fp16" | "fp32";

let extractor: Promise<FeatureExtractionPipeline> | null = null;

function load(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = pipeline("feature-extraction", embedding.model, { dtype: DTYPE });
  }
  return extractor;
}

export function localEmbedder(): Embedder {
  return {
    id: `${embedding.model}/${DTYPE}`,
    dimensions: embedding.dimensions,
    async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
      if (texts.length === 0) return [];
      const model = await load();
      const prefix = embedding.prefixes[kind];
      const vectors: number[][] = [];

      for (let i = 0; i < texts.length; i += embedding.batchSize) {
        const batch = texts.slice(i, i + embedding.batchSize).map((text) => `${prefix}${text}`);
        const output = await model(batch, { pooling: embedding.pooling, normalize: true });
        for (const row of output.tolist() as number[][]) {
          if (row.length !== embedding.dimensions) {
            throw new Error(`${embedding.model} returned ${row.length} dims, expected ${embedding.dimensions}`);
          }
          vectors.push(row);
        }
      }
      return vectors;
    },
  };
}
