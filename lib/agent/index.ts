import { getCorpusOutline, getCorpusVocabulary, type CorpusVocabulary } from "../corpus";
import { getLlm } from "../llm";
import { retrieve } from "../retrieve";
import type { Chunk } from "../types";
import {
  AGENT_DEFAULTS,
  type AgentOptions,
  type AgentRetrieval,
  type AgentStep,
  type AgentTrace,
  type PlannedSearch,
} from "./types";

export * from "./types";

const PLAN_PROMPT = `You plan retrieval over a corpus of SEC 10-K filings. You do not answer questions.

Corpus:
{corpus}

Given a question, decide what to search for. Return JSON:
{
  "needsRetrieval": boolean,
  "searches": [{ "query": string, "purpose": string, "tickers": string[], "fiscalYears": number[], "sections": string[] }]
}

Rules:
- Rewrite the question into search queries that use the vocabulary a filing would actually use. Filings say "Additions to property and equipment", not "capital expenditures"; "loss of exclusivity", not "patent cliff".
- Decompose anything that spans companies or years into one search per company per year. A question comparing FY2024 and FY2025 needs a separate search for each.
- Set tickers and fiscalYears when the question names a company or year. Use empty arrays otherwise.
- Use sections only when the question explicitly names an Item, or when you are certain which Item holds the answer. Cover pages, addresses and exhibit lists have no section, so a section filter hides them. When unsure, leave sections empty.
- Only use values that exist in the corpus above.
- Prefer 1 search for a simple lookup, 2 to 4 for a comparison.
- needsRetrieval is false only for questions that are not about the filings at all.`;

const ASSESS_PROMPT = `You judge whether retrieved SEC filing passages are enough to answer a question. You do not answer it.

Return JSON:
{
  "sufficient": boolean,
  "missing": string,
  "searches": [{ "query": string, "purpose": string, "tickers": string[], "fiscalYears": number[], "sections": string[] }]
}

Set sufficient to true when the passages contain the facts needed. When they do not, describe what is missing and propose searches that would find it, using different wording or different metadata filters than what already failed. Return at most 3 searches.`;

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

interface RawSearch {
  query?: string;
  purpose?: string;
  tickers?: string[];
  fiscalYears?: number[];
  sections?: string[];
}

function keep<T>(values: T[] | undefined, allowed: Set<T>): T[] | undefined {
  if (!values?.length) return undefined;
  const valid = values.filter((value) => allowed.has(value));
  return valid.length > 0 ? valid : undefined;
}

function toPlanned(
  raw: RawSearch[] | undefined,
  limit: number,
  vocab: CorpusVocabulary,
): PlannedSearch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => typeof entry?.query === "string" && entry.query.trim().length > 0)
    .slice(0, limit)
    .map((entry) => ({
      query: entry.query!.trim(),
      purpose: entry.purpose,
      filters: {
        tickers: keep(entry.tickers?.map((value) => value.toUpperCase()), vocab.tickers),
        fiscalYears: keep(entry.fiscalYears?.map(Number), vocab.fiscalYears),
        sections: keep(entry.sections, vocab.sections),
      },
    }));
}

function describeFilters(filters?: PlannedSearch["filters"]): string {
  if (!filters) return "";
  const parts: string[] = [];
  if (filters.tickers?.length) parts.push(filters.tickers.join("/"));
  if (filters.fiscalYears?.length) parts.push(`FY${filters.fiscalYears.join("/FY")}`);
  if (filters.sections?.length) parts.push(filters.sections.join("/"));
  return parts.length > 0 ? ` [${parts.join(" · ")}]` : "";
}

function interleave(groups: Chunk[][]): Chunk[] {
  const merged: Chunk[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...groups.map((group) => group.length));

  for (let i = 0; i < depth; i += 1) {
    for (const group of groups) {
      const chunk = group[i];
      if (chunk && !seen.has(chunk.id)) {
        seen.add(chunk.id);
        merged.push(chunk);
      }
    }
  }
  return merged;
}

function summarise(chunks: Chunk[]): string {
  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.ticker} FY${chunk.fiscalYear} ${chunk.section ?? "front matter"}: ${chunk.text.replace(/\s+/g, " ").slice(0, 320)}`,
    )
    .join("\n\n");
}

export async function agenticRetrieve(question: string, options: AgentOptions = {}): Promise<AgentRetrieval> {
  const k = options.k ?? AGENT_DEFAULTS.k;
  const maxIterations = options.maxIterations ?? AGENT_DEFAULTS.maxIterations;
  const maxSearches = options.maxSearches ?? AGENT_DEFAULTS.maxSearches;
  const perSearchK = options.perSearchK ?? AGENT_DEFAULTS.perSearchK;
  const budgetMs = options.budgetMs ?? Number(process.env.AGENT_BUDGET_MS ?? AGENT_DEFAULTS.budgetMs);
  const deadline = Date.now() + budgetMs;

  const llm = getLlm();
  const steps: AgentStep[] = [];
  const groups: Chunk[][] = [];
  const seen = new Set<string>();
  const attempted = new Set<string>();

  let searchCount = 0;
  let iteration = 0;
  let stoppedBecause: AgentTrace["stoppedBecause"] = "iteration-cap";
  let outOfTime = false;

  const corpus = await getCorpusOutline();
  const vocab = await getCorpusVocabulary();

  const planStarted = Date.now();
  const planRaw = await llm.complete(
    [
      { role: "system", content: PLAN_PROMPT.replace("{corpus}", corpus) },
      { role: "user", content: question },
    ],
    { json: true, maxTokens: 700 },
  );
  const plan = parseJson<{ needsRetrieval?: boolean; searches?: RawSearch[] }>(planRaw);
  let queue = toPlanned(plan?.searches, maxSearches, vocab);

  steps.push({
    iteration: 0,
    kind: "plan",
    detail:
      queue.length === 0
        ? "No searches planned; falling back to the question as written."
        : `Planned ${queue.length} search${queue.length === 1 ? "" : "es"}`,
    elapsedMs: Date.now() - planStarted,
  });

  if (plan?.needsRetrieval === false) {
    return {
      chunks: [],
      trace: { question, steps, searches: 0, iterations: 0, stoppedBecause: "no-retrieval-needed" },
    };
  }

  if (queue.length === 0) queue = [{ query: question }];

  while (queue.length > 0 && iteration < maxIterations) {
    iteration += 1;
    let addedThisRound = 0;

    for (const search of queue) {
      if (searchCount >= maxSearches) break;
      if (Date.now() > deadline) {
        outOfTime = true;
        break;
      }
      const key = `${search.query}|${JSON.stringify(search.filters ?? {})}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      searchCount += 1;

      const started = Date.now();
      const chunks = await retrieve(search.query, {
        strategy: "hybrid+rerank",
        k: perSearchK,
        filters: search.filters,
      });
      const fresh = chunks.filter((chunk) => !seen.has(chunk.id));
      for (const chunk of chunks) seen.add(chunk.id);
      groups.push(chunks);
      addedThisRound += fresh.length;

      steps.push({
        iteration,
        kind: "search",
        detail: search.purpose ?? "Search",
        query: search.query,
        filters: search.filters,
        results: chunks.length,
        newResults: fresh.length,
        elapsedMs: Date.now() - started,
      });
    }

    const merged = interleave(groups);
    if (outOfTime || Date.now() > deadline) {
      stoppedBecause = "time-budget";
      break;
    }
    if (searchCount >= maxSearches || iteration >= maxIterations) {
      stoppedBecause = "iteration-cap";
      break;
    }
    if (addedThisRound === 0) {
      stoppedBecause = "no-progress";
      break;
    }

    const assessStarted = Date.now();
    const assessRaw = await llm.complete(
      [
        { role: "system", content: ASSESS_PROMPT },
        {
          role: "user",
          content: `Question: ${question}\n\nPassages:\n${summarise(merged.slice(0, 12))}`,
        },
      ],
      { json: true, maxTokens: 500 },
    );
    const assessment = parseJson<{ sufficient?: boolean; missing?: string; searches?: RawSearch[] }>(assessRaw);

    if (assessment?.sufficient !== false) {
      steps.push({
        iteration,
        kind: "assess",
        detail: "Passages judged sufficient",
        elapsedMs: Date.now() - assessStarted,
      });
      stoppedBecause = "sufficient";
      break;
    }

    const followUps = toPlanned(assessment?.searches, 3, vocab).filter(
      (search) => !attempted.has(`${search.query}|${JSON.stringify(search.filters ?? {})}`),
    );

    steps.push({
      iteration,
      kind: "assess",
      detail: assessment?.missing?.slice(0, 200) || "Gaps remain",
      results: followUps.length,
      elapsedMs: Date.now() - assessStarted,
    });

    if (followUps.length === 0) {
      stoppedBecause = "no-progress";
      break;
    }
    queue = followUps;

    if (iteration >= maxIterations) stoppedBecause = "iteration-cap";
  }

  return {
    chunks: interleave(groups).slice(0, k),
    trace: { question, steps, searches: searchCount, iterations: iteration, stoppedBecause },
  };
}

export function formatFilters(filters?: PlannedSearch["filters"]): string {
  return describeFilters(filters);
}
