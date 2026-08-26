import { appendFile, mkdir } from "node:fs/promises";
import { answerQuestion } from "../answer";
import { getLlm } from "../llm";
import type { RetrievalStrategy } from "../retrieve";
import type { Chunk } from "../types";
import type { GoldenQuestion } from "./types";

export const FAITHFULNESS_PATH = "eval/faithfulness.jsonl";

export type Verdict = "supported" | "uncited" | "unsupported" | "no-claim";

export interface ClaimAudit {
  claim: string;
  markers: string[];
  verdict: Verdict;
  reason: string;
}

export interface AnswerAudit {
  id: string;
  question: string;
  answer: string;
  abstained: boolean;
  claims: ClaimAudit[];
  elapsedMs: number;
}

export interface FaithfulnessReport {
  ranAt: string;
  strategy: RetrievalStrategy;
  judge: string;
  questions: number;
  abstentions: number;
  claims: number;
  counts: Record<Verdict, number>;
  citationPrecision: number;
  groundedShare: number;
  cleanAnswers: number;
  audits: AnswerAudit[];
}

const JUDGE_PROMPT = `You check whether a single claim about SEC filings is supported by the sources given to you.

The sources are the only evidence that exists. You have no other knowledge of these companies and must not use any.

Sources from different filings look almost identical, so check the specifics, not the shape:
- the company the figure belongs to
- the fiscal year or period end
- the units, scale and any qualifier such as an accounting approach or segment
A claim that reports a real number from the wrong company, wrong year or wrong column is unsupported.

Return JSON: { "verdict": "supported" | "unsupported" | "no-claim", "reason": string }

- "supported": every specific in the claim is stated in the sources.
- "unsupported": the claim asserts something the sources do not state, or state differently.
- "no-claim": the sentence asserts no fact about the filings, such as a statement that the sources are insufficient.

Keep reason under 20 words and point at the specific that decided it.`;

const ABBREVIATION = /(?:^|\s)(?:[A-Z]|U\.S|Inc|Co|Corp|Ltd|No|St|Mr|Ms|Dr|vs|approx|est|Fig|pp)\.$/;

export function splitClaims(answer: string): string[] {
  const pieces = answer
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"“(\[])/);

  const claims: string[] = [];
  for (const piece of pieces) {
    const previous = claims[claims.length - 1];
    if (previous && (ABBREVIATION.test(previous) || piece.length < 15)) {
      claims[claims.length - 1] = `${previous} ${piece}`;
      continue;
    }
    claims.push(piece);
  }
  return claims.filter((claim) => claim.length > 0);
}

export function markersIn(claim: string): string[] {
  return [...new Set([...claim.matchAll(/\[C(\d+)\]/g)].map((match) => `C${match[1]}`))];
}

function sourcesFor(markers: string[], chunks: Chunk[]): Chunk[] {
  if (markers.length === 0) return chunks;
  return markers
    .map((marker) => chunks[Number(marker.slice(1)) - 1])
    .filter((chunk): chunk is Chunk => Boolean(chunk));
}

function renderSources(chunks: Chunk[]): string {
  return chunks.map((chunk, index) => `[S${index + 1}] ${chunk.text}`).join("\n\n---\n\n");
}

function parseVerdict(raw: string): { verdict: string; reason?: string } | null {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function judgeClaim(question: string, claim: string, sources: Chunk[]): Promise<ClaimAudit> {
  const markers = markersIn(claim);

  if (sources.length === 0) {
    return { claim, markers, verdict: "unsupported", reason: "no sources were retrieved" };
  }

  const raw = await getLlm().complete(
    [
      { role: "system", content: JUDGE_PROMPT },
      {
        role: "user",
        content: `Question under answer: ${question}\n\nClaim: ${claim.replace(/\[C\d+\]/g, "").trim()}\n\nSources:\n\n${renderSources(sources)}`,
      },
    ],
    { json: true, maxTokens: 200 },
  );

  const parsed = parseVerdict(raw);
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "";

  if (parsed?.verdict === "no-claim") return { claim, markers, verdict: "no-claim", reason };
  if (parsed?.verdict === "supported") {
    return { claim, markers, verdict: markers.length > 0 ? "supported" : "uncited", reason };
  }
  if (parsed?.verdict === "unsupported") return { claim, markers, verdict: "unsupported", reason };
  return { claim, markers, verdict: "unsupported", reason: "judge returned no usable verdict" };
}

export interface FaithfulnessOptions {
  strategy: RetrievalStrategy;
  k?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runFaithfulness(
  questions: GoldenQuestion[],
  options: FaithfulnessOptions,
): Promise<FaithfulnessReport> {
  const audits: AnswerAudit[] = [];

  for (const [index, question] of questions.entries()) {
    const started = Date.now();
    const result = await answerQuestion(question.question, {
      strategy: options.strategy,
      k: options.k ?? 8,
    });

    const claims: ClaimAudit[] = [];
    for (const claim of splitClaims(result.answer)) {
      claims.push(await judgeClaim(question.question, claim, sourcesFor(markersIn(claim), result.chunks)));
    }

    audits.push({
      id: question.id,
      question: question.question,
      answer: result.answer,
      abstained: result.chunks.length === 0,
      claims,
      elapsedMs: Date.now() - started,
    });
    options.onProgress?.(index + 1, questions.length);
  }

  const all = audits.flatMap((audit) => audit.claims);
  const counts: Record<Verdict, number> = { supported: 0, uncited: 0, unsupported: 0, "no-claim": 0 };
  for (const claim of all) counts[claim.verdict] += 1;

  const factual = counts.supported + counts.uncited + counts.unsupported;
  const cited = counts.supported + counts.unsupported;

  return {
    ranAt: new Date().toISOString(),
    strategy: options.strategy,
    judge: getLlm().id,
    questions: questions.length,
    abstentions: audits.filter((audit) => audit.abstained).length,
    claims: all.length,
    counts,
    citationPrecision: cited === 0 ? 0 : counts.supported / cited,
    groundedShare: factual === 0 ? 0 : (counts.supported + counts.unsupported) / factual,
    cleanAnswers: audits.filter((audit) => audit.claims.every((claim) => claim.verdict !== "unsupported")).length,
    audits,
  };
}

export async function appendFaithfulness(
  report: FaithfulnessReport,
  path = FAITHFULNESS_PATH,
): Promise<void> {
  await mkdir("eval", { recursive: true });
  const { audits, ...summary } = report;
  void audits;
  await appendFile(path, `${JSON.stringify(summary)}\n`, "utf8");
}

export function formatFaithfulness(report: FaithfulnessReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push(`strategy: ${report.strategy}   questions: ${report.questions}   judge: ${report.judge}`);
  lines.push("");
  lines.push(`claims judged      ${report.claims}`);
  lines.push(`  supported        ${report.counts.supported}`);
  lines.push(`  uncited          ${report.counts.uncited}`);
  lines.push(`  unsupported      ${report.counts.unsupported}`);
  lines.push(`  no claim         ${report.counts["no-claim"]}`);
  lines.push("");
  lines.push(`citation precision ${pct(report.citationPrecision)}`);
  lines.push(`grounded share     ${pct(report.groundedShare)}`);
  lines.push(`clean answers      ${report.cleanAnswers}/${report.questions}`);
  lines.push(`abstentions        ${report.abstentions}`);

  const problems = report.audits.filter((audit) =>
    audit.claims.some((claim) => claim.verdict === "unsupported" || claim.verdict === "uncited"),
  );
  if (problems.length > 0) {
    lines.push("");
    lines.push("flagged:");
    for (const audit of problems) {
      for (const claim of audit.claims) {
        if (claim.verdict !== "unsupported" && claim.verdict !== "uncited") continue;
        lines.push(`  ${audit.id} ${claim.verdict}: ${claim.claim.slice(0, 100)}`);
        if (claim.reason) lines.push(`    ${claim.reason.slice(0, 100)}`);
      }
    }
  }
  return lines.join("\n");
}
