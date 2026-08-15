import { closeDb, db } from "../lib/db";
import { dryRunCorpus, ingestCorpus } from "../lib/ingest/pipeline";

function flag(name: string): string | undefined {
  const entry = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return entry?.split("=")[1];
}

async function main() {
  const companies = flag("companies")?.split(",").map((value) => value.trim().toUpperCase());
  const years = flag("years") ? Number(flag("years")) : undefined;
  const force = process.argv.includes("--force");

  const started = Date.now();

  if (process.argv.includes("--dry")) {
    const dry = await dryRunCorpus({ companies, years, onProgress: (message) => console.log(message) });
    const chunks = dry.reduce((total, result) => total + result.chunks, 0);
    console.log(`\n${dry.length} filings, ${chunks} chunks, no database or embedding calls made.`);
    return;
  }

  const results = await ingestCorpus({
    companies,
    years,
    force,
    onProgress: (message) => console.log(message),
  });

  const ingested = results.filter((result) => result.status === "ingested");
  const totals = results.reduce(
    (acc, result) => ({
      chunks: acc.chunks + result.chunks,
      embedded: acc.embedded + result.embedded,
      reused: acc.reused + result.reused,
    }),
    { chunks: 0, embedded: 0, reused: 0 },
  );

  const [corpus] = await db()<{ documents: number; chunks: number; tokens: number }[]>`
    select
      (select count(*) from documents) as documents,
      (select count(*) from chunks) as chunks,
      (select coalesce(sum(token_count), 0) from chunks) as tokens
  `;

  console.log("\n--- ingest summary ---");
  console.log(`filings processed : ${results.length} (${ingested.length} ingested, ${results.length - ingested.length} unchanged)`);
  console.log(`chunks written    : ${totals.chunks} (${totals.embedded} embedded, ${totals.reused} cached)`);
  console.log(`corpus totals     : ${corpus.documents} documents, ${corpus.chunks} chunks, ${corpus.tokens} tokens`);
  console.log(`elapsed           : ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const bySection = await db()<{ section: string | null; chunks: number }[]>`
    select section, count(*) as chunks from chunks group by section order by chunks desc limit 12
  `;
  console.log("\ntop sections by chunk count:");
  for (const row of bySection) {
    console.log(`  ${(row.section ?? "(none)").padEnd(10)} ${row.chunks}`);
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
