import { getLlm } from "./llm";
import { retrieve, type RetrieveOpts } from "./retrieve";
import { markersIn, sentenceSpans } from "./text";
import type { AgentTrace } from "./agent/types";
import type { Chunk } from "./types";

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

export interface AnswerCitation {
  marker: string;
  chunkId: string;
  ticker: string;
  fiscalYear: number;
  section: string | null;
  score?: number;
}

export interface AnswerResult {
  question: string;
  trace?: AgentTrace;
  answer: string;
  citations: AnswerCitation[];
  chunks: Chunk[];
  usedChunkIds: string[];
  model: string;
  elapsedMs: number;
}

const ATTRIBUTE_PROMPT = `You attach citations to sentences that are missing them. You never rewrite a sentence and you never add information.

For each numbered sentence, list the sources that state what the sentence asserts. A source counts only if it contains the words or the figure being reported, not if it merely discusses the same subject. Sources from different filings look alike, so check the company, fiscal year, units and any column label before accepting one.

Return JSON: { "attributions": [{ "sentence": number, "markers": string[] }] }

Use an empty markers array when no source states the sentence, and when the sentence asserts no fact about the filings — a transition, a statement that the sources are insufficient, or a description of what is missing.`;

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

    const trailing = /[.!?"”)\]]+$/.exec(target.text);
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

function renderContext(chunks: Chunk[]): string {
  return chunks
    .map((chunk, index) => `[C${index + 1}] ${chunk.text}`)
    .join("\n\n---\n\n");
}

export async function answerQuestion(question: string, opts: RetrieveOpts = {}): Promise<AnswerResult> {
  const started = Date.now();
  const strategy = opts.strategy ?? "agentic";
  const k = opts.k ?? 8;

  let chunks;
  let trace: AgentTrace | undefined;

  if (strategy === "agentic") {
    const { agenticRetrieve } = await import("./agent");
    const result = await agenticRetrieve(question, { k });
    chunks = result.chunks;
    trace = result.trace;
  } else {
    chunks = await retrieve(question, { strategy, k, filters: opts.filters });
  }

  const citations: AnswerCitation[] = chunks.map((chunk, index) => ({
    marker: `C${index + 1}`,
    chunkId: chunk.id,
    ticker: chunk.ticker,
    fiscalYear: chunk.fiscalYear,
    section: chunk.section,
    score: chunk.score,
  }));

  if (chunks.length === 0) {
    return {
      question,
      trace,
      answer: "No filings in the corpus matched that question, so there is nothing to cite.",
      citations: [],
      chunks: [],
      usedChunkIds: [],
      model: getLlm().id,
      elapsedMs: Date.now() - started,
    };
  }

  const llm = getLlm();
  const drafted = await llm.complete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Sources:\n\n${renderContext(chunks)}\n\nQuestion: ${question}` },
  ]);
  const answer = await attributeUncited(question, drafted, chunks);

  const used = new Set<string>();
  for (const match of answer.matchAll(/\[C(\d+)\]/g)) {
    const chunk = chunks[Number(match[1]) - 1];
    if (chunk) used.add(chunk.id);
  }

  return {
    question,
    trace,
    answer,
    citations,
    chunks,
    usedChunkIds: [...used],
    model: llm.id,
    elapsedMs: Date.now() - started,
  };
}
