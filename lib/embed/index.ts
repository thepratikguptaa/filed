import { embedding } from "../config";
import { azureEmbedder } from "./azure";
import { localEmbedder } from "./local";
import type { Embedder } from "./types";

export type { EmbedKind, Embedder } from "./types";

let cached: Embedder | null = null;

export function getEmbedder(): Embedder {
  if (!cached) cached = embedding.kind === "azure" ? azureEmbedder() : localEmbedder();
  return cached;
}
