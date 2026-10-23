import { createHash } from "node:crypto";
import type { StreamEvent } from "./answer-stream";

interface CacheEntry {
  events: StreamEvent[];
  cachedAt: number;
}

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_ENTRIES = 250;

const cache = new Map<string, CacheEntry>();

export function computeCacheKey(params: {
  question: string;
  strategy?: string;
  k?: number;
  history?: { question: string; answer: string };
}): string {
  const normQuestion = params.question.trim().toLowerCase();
  const normStrategy = params.strategy ?? "agentic";
  const normK = params.k ?? 8;
  const historyKey = params.history
    ? `${params.history.question.trim().toLowerCase()}|${params.history.answer.slice(0, 100)}`
    : "";

  const payload = `${normQuestion}::${normStrategy}::${normK}::${historyKey}`;
  return createHash("sha256").update(payload).digest("hex");
}

export function getCachedAnswer(key: string, ttlMs = DEFAULT_TTL_MS): StreamEvent[] | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }

  // Refresh LRU order
  cache.delete(key);
  cache.set(key, entry);

  return entry.events;
}

export function setCachedAnswer(key: string, events: StreamEvent[]): void {
  // Evict oldest if limit reached
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, {
    events,
    cachedAt: Date.now(),
  });
}

export function clearAnswerCache(): void {
  cache.clear();
}
