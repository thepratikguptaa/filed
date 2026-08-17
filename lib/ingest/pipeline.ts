import { getEmbedder } from "../embed";
import { toVectorLiteral } from "../db";
import type { FilingRef } from "../types";
import { chunkFiling } from "./chunk";
import { fetchFilingHtml, listFilings } from "./edgar";
import { parseFiling } from "./parse";
import { CORPUS, YEARS_PER_COMPANY, type CorpusCompany } from "./corpus";
import { documentIsCurrent, existingEmbeddings, persistFiling } from "./store";

export interface IngestResult {
  filing: FilingRef;
  status: "ingested" | "skipped";
  sections: number;
  chunks: number;
  embedded: number;
  reused: number;
}

export interface IngestOptions {
  force?: boolean;
  companies?: string[];
  years?: number;
  onProgress?: (message: string) => void;
}

export async function ingestFiling(filing: FilingRef, options: IngestOptions = {}): Promise<IngestResult> {
  const log = options.onProgress ?? (() => {});
  const documentId = filing.accessionNumber.replace(/-/g, "");
  const { html, contentHash } = await fetchFilingHtml(filing);

  if (!options.force && (await documentIsCurrent(documentId, contentHash))) {
    return { filing, status: "skipped", sections: 0, chunks: 0, embedded: 0, reused: 0 };
  }

  const parsed = parseFiling(html);
  const chunks = chunkFiling(filing, parsed.sections);
  log(`  parsed ${parsed.sections.length} sections -> ${chunks.length} chunks`);

  const cache = await existingEmbeddings([...new Set(chunks.map((chunk) => chunk.contentHash))]);
  const pending = chunks.filter((chunk) => !cache.has(chunk.contentHash));
  log(`  embedding ${pending.length} new chunks (${chunks.length - pending.length} reused)`);

  if (pending.length > 0) {
    const vectors = await getEmbedder().embed(pending.map((chunk) => chunk.text), "document");
    pending.forEach((chunk, index) => cache.set(chunk.contentHash, toVectorLiteral(vectors[index])));
  }

  const literals = chunks.map((chunk) => cache.get(chunk.contentHash)!);
  await persistFiling(filing, contentHash, chunks, literals);

  return {
    filing,
    status: "ingested",
    sections: parsed.sections.length,
    chunks: chunks.length,
    embedded: pending.length,
    reused: chunks.length - pending.length,
  };
}

export async function dryRunCorpus(options: IngestOptions = {}): Promise<IngestResult[]> {
  const log = options.onProgress ?? (() => {});
  const selected = options.companies?.length
    ? CORPUS.filter((company) => options.companies!.includes(company.ticker))
    : CORPUS;

  const results: IngestResult[] = [];
  for (const company of selected) {
    const filings = await listFilings(company, "10-K", options.years ?? YEARS_PER_COMPANY);
    for (const filing of filings) {
      const { html } = await fetchFilingHtml(filing);
      const parsed = parseFiling(html);
      const chunks = chunkFiling(filing, parsed.sections);
      const tokens = chunks.map((chunk) => chunk.tokenCount);
      const median = [...tokens].sort((a, b) => a - b)[Math.floor(tokens.length / 2)] ?? 0;
      log(
        `${filing.ticker} FY${filing.fiscalYear}  ${String(parsed.sections.length).padStart(2)} sections  ` +
          `${String(chunks.length).padStart(4)} chunks  median ${median} tok  ` +
          `max ${Math.max(...tokens, 0)} tok  ${chunks.filter((chunk) => chunk.hasTable).length} with tables`,
      );
      results.push({
        filing,
        status: "ingested",
        sections: parsed.sections.length,
        chunks: chunks.length,
        embedded: 0,
        reused: 0,
      });
    }
  }
  return results;
}

export async function ingestCorpus(options: IngestOptions = {}): Promise<IngestResult[]> {
  const log = options.onProgress ?? (() => {});
  const selected: CorpusCompany[] = options.companies?.length
    ? CORPUS.filter((company) => options.companies!.includes(company.ticker))
    : CORPUS;

  const results: IngestResult[] = [];
  for (const company of selected) {
    const filings = await listFilings(company, "10-K", options.years ?? YEARS_PER_COMPANY);
    for (const filing of filings) {
      log(`${filing.ticker} FY${filing.fiscalYear} ${filing.filingType} ${filing.accessionNumber}`);
      const result = await ingestFiling(filing, options);
      log(`  ${result.status}${result.status === "ingested" ? ` (${result.chunks} chunks)` : ""}`);
      results.push(result);
    }
  }
  return results;
}
