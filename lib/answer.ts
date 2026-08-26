import { getLlm } from "./llm";
import { retrieve, type RetrieveOpts } from "./retrieve";
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
  const answer = await llm.complete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Sources:\n\n${renderContext(chunks)}\n\nQuestion: ${question}` },
  ]);

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
