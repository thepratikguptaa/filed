import { openaiEmbedder } from "./openai";
import type { Embedder } from "./types";

export type { Embedder };

export function getEmbedder(): Embedder {
  return openaiEmbedder();
}
