import { appendFile, mkdir } from "node:fs/promises";
import { retrieve, type RetrievalStrategy } from "../retrieve";
import { aggregate, K_VALUES, scoreQuestion } from "./metrics";
import type { EvalReport, GoldenQuestion, QuestionScore } from "./types";

export const HISTORY_PATH = "eval/history.jsonl";

export interface RunOptions {
  strategy: RetrievalStrategy;
  k?: number;
  candidateK?: number;
  goldenVersion: number;
  onProgress?: (done: number, total: number) => void;
}

export async function runEval(questions: GoldenQuestion[], options: RunOptions): Promise<EvalReport> {
  const k = options.k ?? Math.max(...K_VALUES);
  const scores: QuestionScore[] = [];

  for (const [index, question] of questions.entries()) {
    const retrieved = await retrieve(question.question, {
      strategy: options.strategy,
      k,
      candidateK: options.candidateK,
    });
    scores.push(scoreQuestion(question, retrieved));
    options.onProgress?.(index + 1, questions.length);
  }

  const byCategory: EvalReport["byCategory"] = {};
  for (const category of new Set(scores.map((score) => score.category))) {
    const subset = scores.filter((score) => score.category === category);
    byCategory[category] = { questions: subset.length, ...aggregate(subset) };
  }

  return {
    ranAt: new Date().toISOString(),
    strategy: options.strategy,
    candidateK: options.candidateK,
    k,
    goldenVersion: options.goldenVersion,
    questions: questions.length,
    overall: aggregate(scores),
    byCategory,
    scores,
  };
}

export async function appendHistory(report: EvalReport, path = HISTORY_PATH): Promise<void> {
  await mkdir("eval", { recursive: true });
  const { scores, ...summary } = report;
  void scores;
  await appendFile(path, `${JSON.stringify(summary)}\n`, "utf8");
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

  lines.push(`strategy: ${report.strategy}   questions: ${report.questions}   golden v${report.goldenVersion}`);
  lines.push("");
  lines.push(`${"".padEnd(16)}${K_VALUES.map((k) => `recall@${k}`.padStart(10)).join("")}${"MRR".padStart(10)}`);
  lines.push(
    `${"overall".padEnd(16)}${K_VALUES.map((k) => pct(report.overall.recallAt[k]).padStart(10)).join("")}${report.overall.mrr.toFixed(3).padStart(10)}`,
  );

  for (const [category, stats] of Object.entries(report.byCategory).sort()) {
    const label = `${category} (${stats.questions})`;
    lines.push(
      `${label.padEnd(16)}${K_VALUES.map((k) => pct(stats.recallAt[k]).padStart(10)).join("")}${stats.mrr.toFixed(3).padStart(10)}`,
    );
  }

  const misses = report.scores.filter((score) => score.firstRelevantRank === null);
  if (misses.length > 0) {
    lines.push("");
    lines.push(`no relevant chunk in top ${report.k} (${misses.length}): ${misses.map((m) => m.id).join(", ")}`);
  }
  return lines.join("\n");
}
