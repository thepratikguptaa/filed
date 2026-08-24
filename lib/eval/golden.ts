import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { embedding } from "../config";
import type { Chunk } from "../types";
import type { GoldenQuestion, GoldenSet, Label } from "./types";

export const GOLDEN_PATH = "eval/golden.json";
export const DRAFT_PATH = "eval/questions.draft.json";

const ANCHOR_CHARS = 140;

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function makeAnchor(text: string): string {
  const flat = normalize(text);
  if (flat.length <= ANCHOR_CHARS) return flat;
  const start = Math.max(0, Math.floor((flat.length - ANCHOR_CHARS) / 2));
  return flat.slice(start, start + ANCHOR_CHARS);
}

export function labelFromChunk(chunk: Chunk): Label {
  return {
    chunkId: chunk.id,
    documentId: chunk.documentId,
    section: chunk.section,
    anchor: makeAnchor(chunk.text),
  };
}

export function isRelevant(chunk: Chunk, labels: Label[]): boolean {
  const flat = normalize(chunk.text);
  return labels.some((label) => chunk.id === label.chunkId || flat.includes(label.anchor));
}

export async function loadGolden(path = GOLDEN_PATH): Promise<GoldenSet> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as GoldenSet;
  } catch {
    return { version: 1, embedder: embedding.model, questions: [] };
  }
}

export async function saveGolden(set: GoldenSet, path = GOLDEN_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(set, null, 2)}\n`, "utf8");
}

export async function loadDraft(path = DRAFT_PATH): Promise<GoldenQuestion[]> {
  return JSON.parse(await readFile(path, "utf8")) as GoldenQuestion[];
}

export function labelledQuestions(set: GoldenSet): GoldenQuestion[] {
  return set.questions.filter((question) => question.labels.length > 0);
}
