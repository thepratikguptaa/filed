import { getLlm } from "./llm";
import { retrieve, type RetrieveOpts } from "./retrieve";
import type { Chunk } from "./types";

const SYSTEM_PROMPT = `You are a research assistant that answers questions about public SEC filings.

Rules you must follow:
- Answer only from the numbered sources provided. They are the whole of your knowledge for this task.
- Cite the sources you use inline, like [C1] or [C2][C4], immediately after the claim they support.
- If the sources do not contain enough information to answer, say so plainly and state what is missing. Do not fill the gap from memory.
- Quote figures exactly as they appear, including units and fiscal year. Never estimate or extrapolate a number.
- Name the company and fiscal year when reporting a figure, because sources from different filings look alike.
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
  answer: string;
  citations: AnswerCitation[];
  chunks: Chunk[];
  usedChunkIds: string[];
  model: string;
  elapsedMs: number;
}

function renderContext(chunks: Chunk[]): string {
  return chunks
    .map((chunk, index) => {
      const header = `[C${index + 1}] ${chunk.company} (${chunk.ticker}) FY${chunk.fiscalYear} ${chunk.filingType} — ${chunk.section ?? "front matter"}`;
      return `${header}\n${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

export async function answerQuestion(question: string, opts: RetrieveOpts = {}): Promise<AnswerResult> {
  const started = Date.now();
  const chunks = await retrieve(question, { strategy: opts.strategy ?? "vector", k: opts.k ?? 8, filters: opts.filters });

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
    answer,
    citations,
    chunks,
    usedChunkIds: [...used],
    model: llm.id,
    elapsedMs: Date.now() - started,
  };
}
