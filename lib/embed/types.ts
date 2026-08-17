export type EmbedKind = "document" | "query";

export interface Embedder {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}
