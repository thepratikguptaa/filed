import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env, paths } from "../config";
import type { FilingRef, FilingType } from "../types";
import type { CorpusCompany } from "./corpus";

const MIN_REQUEST_GAP_MS = 150;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

async function fetchText(url: string, attempt = 0): Promise<string> {
  await throttle();
  const response = await fetch(url, {
    headers: {
      "User-Agent": env.secUserAgent,
      "Accept-Encoding": "gzip, deflate",
    },
  });

  if (response.status === 429 || response.status >= 500) {
    if (attempt >= 4) throw new Error(`EDGAR ${response.status} after retries: ${url}`);
    const backoff = 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    return fetchText(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`EDGAR ${response.status} ${response.statusText}: ${url}`);

  return response.text();
}

async function cached(cacheKey: string, loader: () => Promise<string>): Promise<string> {
  const file = join(paths.rawCache, cacheKey);
  try {
    return await readFile(file, "utf8");
  } catch {
    const body = await loader();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
    return body;
  }
}

interface RecentFilings {
  form: string[];
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  primaryDocument: string[];
}

interface SubmissionsResponse {
  name: string;
  cik: string;
  filings: {
    recent: RecentFilings;
    files: { name: string; filingFrom: string; filingTo: string }[];
  };
}

function fiscalYearFor(reportDate: string): number {
  const [year, month] = reportDate.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

export function documentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const bareCik = String(Number(cik));
  const bareAccession = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${bareCik}/${bareAccession}/${primaryDocument}`;
}

function collectFrom(
  page: RecentFilings,
  company: CorpusCompany,
  filingType: FilingType,
  into: FilingRef[],
  limit: number,
): void {
  for (let i = 0; i < page.form.length && into.length < limit; i += 1) {
    if (page.form[i] !== filingType) continue;
    const accessionNumber = page.accessionNumber[i];
    into.push({
      accessionNumber,
      cik: company.cik,
      company: company.name,
      ticker: company.ticker,
      filingType,
      fiscalYear: fiscalYearFor(page.reportDate[i]),
      periodEnd: page.reportDate[i],
      filedDate: page.filingDate[i],
      primaryDocument: page.primaryDocument[i],
      sourceUrl: documentUrl(company.cik, accessionNumber, page.primaryDocument[i]),
    });
  }
}

export async function listFilings(
  company: CorpusCompany,
  filingType: FilingType,
  limit: number,
): Promise<FilingRef[]> {
  const raw = await cached(
    `submissions/CIK${company.cik}.json`,
    () => fetchText(`https://data.sec.gov/submissions/CIK${company.cik}.json`),
  );
  const submissions = JSON.parse(raw) as SubmissionsResponse;

  const filings: FilingRef[] = [];
  collectFrom(submissions.filings.recent, company, filingType, filings, limit);

  for (const page of submissions.filings.files ?? []) {
    if (filings.length >= limit) break;
    const body = await cached(`submissions/${page.name}`, () =>
      fetchText(`https://data.sec.gov/submissions/${page.name}`),
    );
    collectFrom(JSON.parse(body) as RecentFilings, company, filingType, filings, limit);
  }

  return filings;
}

export async function fetchFilingHtml(filing: FilingRef): Promise<{ html: string; contentHash: string }> {
  const key = `filings/${filing.ticker}/${filing.accessionNumber}-${filing.primaryDocument}`;
  const html = await cached(key, () => fetchText(filing.sourceUrl));
  return { html, contentHash: createHash("sha256").update(html).digest("hex") };
}
