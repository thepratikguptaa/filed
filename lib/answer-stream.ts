import { getLlm } from "./llm";
import { retrieve, type RetrieveOpts } from "./retrieve";
import { expandWithNeighbours } from "./retrieve/expand";
import { computeCacheKey, getCachedAnswer, setCachedAnswer } from "./cache";
import { markersIn, sentenceSpans } from "./text";
import type { AgentStep, AgentTrace } from "./agent/types";
import type { AnswerCitation } from "./answer";
import type { Chunk } from "./types";
import type { Message as PriorMessage } from "./llm/types";

// ─── SSE event types ────────────────────────────────────────────────

export type StreamEvent =
  | { type: "trace"; step: AgentStep }
  | { type: "sources"; citations: AnswerCitation[]; chunks: Chunk[] }
  | { type: "answer-delta"; text: string }
  | { type: "answer-done"; answer: string; usedChunkIds: string[]; model: string; elapsedMs: number; trace?: AgentTrace }
  | { type: "error"; message: string };

// ─── Shared prompts (kept in sync with answer.ts) ───────────────────

const SYSTEM_PROMPT = `You are a research assistant that answers questions about public SEC filings.

Rules you must follow:
- Answer only from the numbered sources provided. They are the whole of your knowledge for this task.
- Cite inline, like [C1] or [C2][C4], immediately after the claim the source supports. Every sentence that states a fact from the filings carries at least one marker. A sentence with no marker is only acceptable when it asserts no fact.
- Cite the source that actually contains the words or the figure you are reporting, not a neighbouring source on the same subject.
- If the sources do not contain enough information to answer, say so in prose and name what is missing. Do not fill the gap from memory, and do not write out headings or labels.
- Quote figures exactly as they appear, including units and fiscal year. Never estimate or extrapolate a number.
- Name the company and fiscal year when reporting a figure, because sources from different filings look alike.
- Table columns carry their own labels, such as "Standardized December 31, 2024" or "Advanced JPMorgan Chase Bank, N.A.". Read the label of the column a figure sits in and report the figure only if that label matches what was asked. Neighbouring columns hold the same measure for a different year, entity or basis.
- You are not a financial adviser. Never recommend buying, selling or holding a security, and never characterise anything as a good or bad investment. Report what the filings say and stop there.

Write in plain prose. Be brief. Do not add a preamble or a closing summary.`;

const COMPARISON_SYSTEM_PROMPT = `You are a research assistant that compares companies, fiscal periods, and metrics from public SEC filings.

Rules you must follow:
- Answer only from the numbered sources provided. They are the whole of your knowledge for this task.
- Structure your response for clear comparison:
  * Group facts by company or fiscal period.
  * Explicitly highlight variances, percentage changes, or differences in metrics between the entities.
  * Contrast equivalent measures directly, noting any differences in accounting definitions, timing, or basis.
- Cite inline, like [C1] or [C2][C4], immediately after every claim from the filings. Every fact must carry a marker.
- Quote figures exactly as they appear, with explicit company name, units, and fiscal year. Never estimate or extrapolate.
- You are not a financial adviser. Do not recommend buying, selling, or holding any security. Report what the filings state and compare objectively.

Write in structured prose with bullet points or side-by-side breakdowns where appropriate. Be concise.`;

export function isComparative(question: string, chunks: Chunk[]): boolean {
  const compKeyword = /\b(compare|comparison|versus|vs\.?|differ|differences|higher|lower|more than|less than|change from|between)\b/i;
  if (compKeyword.test(question)) return true;
  const tickers = new Set(chunks.map((c) => c.ticker));
  if (tickers.size > 1) return true;
  const years = new Set(chunks.map((c) => c.fiscalYear));
  return years.size > 1 && /\b(growth|change|trend|increase|decrease|prior year)\b/i.test(question);
}

const ATTRIBUTE_PROMPT = `You attach citations to sentences that are missing them. You never rewrite a sentence and you never add information.

For each numbered sentence, list the sources that state what the sentence asserts. A source counts only if it contains the words or the figure being reported, not if it merely discusses the same subject. Sources from different filings look alike, so check the company, fiscal year, units and any column label before accepting one.

Return JSON: { "attributions": [{ "sentence": number, "markers": string[] }] }

Use an empty markers array when no source states the sentence, and when the sentence asserts no fact about the filings — a transition, a statement that the sources are insufficient, or a description of what is missing.`;

function renderContext(chunks: Chunk[]): string {
  return chunks
    .map((chunk, index) => `[C${index + 1}] ${chunk.text}`)
    .join("\n\n---\n\n");
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

async function attributeUncited(question: string, answer: string, chunks: Chunk[]): Promise<string> {
  const pending = sentenceSpans(answer).filter((span) => markersIn(span.text).length === 0);
  if (pending.length === 0) return answer;

  const listed = pending.map((span, index) => `${index + 1}. ${span.text}`).join("\n");
  const raw = await getLlm().complete(
    [
      { role: "system", content: ATTRIBUTE_PROMPT },
      {
        role: "user",
        content: `Question: ${question}\n\nSentences:\n${listed}\n\nSources:\n\n${renderContext(chunks)}`,
      },
    ],
    { json: true, maxTokens: 400 },
  );

  const parsed = parseJson<{ attributions?: { sentence?: number; markers?: string[] }[] }>(raw);
  if (!Array.isArray(parsed?.attributions)) return answer;

  const edits: { at: number; text: string }[] = [];
  for (const entry of parsed.attributions) {
    const target = pending[Number(entry?.sentence) - 1];
    if (!target) continue;

    const markers = [...new Set(entry?.markers ?? [])].filter((marker) => {
      const index = /^C(\d+)$/.exec(marker)?.[1];
      return index !== undefined && Number(index) >= 1 && Number(index) <= chunks.length;
    });
    if (markers.length === 0) continue;

    const trailing = /[.!?"")\\]]+$/.exec(target.text);
    edits.push({
      at: target.end - (trailing?.[0].length ?? 0),
      text: ` ${markers.map((marker) => `[${marker}]`).join("")}`,
    });
  }

  let attributed = answer;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    attributed = `${attributed.slice(0, edit.at)}${edit.text}${attributed.slice(edit.at)}`;
  }
  return attributed;
}

// ─── Streaming entry point ──────────────────────────────────────────

export interface StreamAnswerOpts extends RetrieveOpts {
  /** Prior conversation turn for follow-up context */
  history?: { question: string; answer: string };
  /** Bypass cache to force fresh retrieval */
  skipCache?: boolean;
}

/**
 * Stream an answer as a series of events. The caller gets trace steps in
 * real-time as the agent works, then answer tokens as the LLM drafts,
 * then the final attributed answer.
 */
export async function* streamAnswer(
  question: string,
  opts: StreamAnswerOpts = {},
): AsyncGenerator<StreamEvent> {
  const started = Date.now();
  const strategy = opts.strategy ?? "agentic";
  const k = opts.k ?? 8;
  const llm = getLlm();

  const cacheKey = computeCacheKey({ question, strategy, k, history: opts.history });
  if (!opts.skipCache) {
    const cached = getCachedAnswer(cacheKey);
    if (cached) {
      for (const event of cached) {
        yield event;
      }
      return;
    }
  }

  const collectedEvents: StreamEvent[] = [];
  const emit = (event: StreamEvent): StreamEvent => {
    collectedEvents.push(event);
    return event;
  };

  let chunks: Chunk[];
  let trace: AgentTrace | undefined;

  // ── Retrieval (with streaming trace steps) ──

  if (strategy === "agentic") {
    const { agenticRetrieveStreaming } = await import("./agent/streaming");
    const result = agenticRetrieveStreaming(question, { k });
    for await (const event of result.steps) {
      yield emit({ type: "trace", step: event });
    }
    chunks = result.chunks;
    trace = result.trace;
  } else {
    chunks = await retrieve(question, { strategy, k, filters: opts.filters });
  }

  // ── Chunk neighbour expansion ──

  chunks = await expandWithNeighbours(chunks);

  // ── Emit sources ──

  const citations: AnswerCitation[] = chunks.map((chunk, index) => ({
    marker: `C${index + 1}`,
    chunkId: chunk.id,
    company: chunk.company,
    ticker: chunk.ticker,
    fiscalYear: chunk.fiscalYear,
    section: chunk.section,
    score: chunk.score,
    sourceUrl: chunk.sourceUrl,
  }));

  yield emit({ type: "sources", citations, chunks });

  if (chunks.length === 0) {
    const isOutOfDomain = trace?.stoppedBecause === "no-retrieval-needed";
    const doneEvent: StreamEvent = {
      type: "answer-done",
      answer: isOutOfDomain
        ? "Filed only answers questions about public SEC filings for companies in the corpus (Apple, Microsoft, JPMorgan, Pfizer, ExxonMobil). Please ask a question about their business, financial statements, or risk disclosures."
        : "No filings in the corpus matched that question, so there is nothing to cite.",
      usedChunkIds: [],
      model: llm.id,
      elapsedMs: Date.now() - started,
      trace,
    };
    emit(doneEvent);
    yield doneEvent;
    return;
  }

  // ── Build messages with optional conversation history ──

  const messages: PriorMessage[] = [
    { role: "system", content: isComparative(question, chunks) ? COMPARISON_SYSTEM_PROMPT : SYSTEM_PROMPT },
  ];

  if (opts.history) {
    messages.push(
      { role: "user", content: `Previous question: ${opts.history.question}` },
      { role: "assistant", content: opts.history.answer },
    );
  }

  messages.push({
    role: "user",
    content: `Sources:\n\n${renderContext(chunks)}\n\nQuestion: ${question}`,
  });

  // ── Stream draft answer ──

  let drafted = "";
  for await (const delta of llm.stream(messages)) {
    drafted += delta;
    yield emit({ type: "answer-delta", text: delta });
  }

  // ── Attribution pass ──

  const answer = await attributeUncited(question, drafted, chunks);

  const used = new Set<string>();
  for (const match of answer.matchAll(/\[C(\d+)\]/g)) {
    const chunk = chunks[Number(match[1]) - 1];
    if (chunk) used.add(chunk.id);
  }

  const finalDone: StreamEvent = {
    type: "answer-done",
    answer,
    usedChunkIds: [...used],
    model: llm.id,
    elapsedMs: Date.now() - started,
    trace,
  };
  emit(finalDone);
  setCachedAnswer(cacheKey, collectedEvents);
  yield finalDone;
}
