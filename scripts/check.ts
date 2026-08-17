import { closeDb, db } from "../lib/db";
import { getEmbedder } from "../lib/embed";
import { embedding, env } from "../lib/config";
import { listFilings } from "../lib/ingest/edgar";
import { CORPUS } from "../lib/ingest/corpus";

type Check = { name: string; ok: boolean; detail: string };

async function run(name: string, fn: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { name, ok: false, detail: `${status ? `${status} ` : ""}${(error as Error).message}`.slice(0, 200) };
  }
}

async function main() {
  const checks: Check[] = [];

  checks.push(await run("env", async () => {
    void env.databaseUrl;
    void env.azureApiKey;
    void env.secUserAgent;
    return `endpoint ${env.azureEndpoint}, deployment ${env.azureEmbeddingDeployment}`;
  }));

  checks.push(await run("database", async () => {
    const [row] = await db()<{ version: string }[]>`select version() as version`;
    const [ext] = await db()<{ installed: string | null }[]>`
      select installed_version as installed from pg_available_extensions where name = 'vector'
    `;
    return `${row.version.split(",")[0]}, pgvector ${ext?.installed ?? "not installed"}`;
  }));

  checks.push(await run("schema", async () => {
    const [row] = await db()<{ documents: number; chunks: number }[]>`
      select
        (select count(*) from documents) as documents,
        (select count(*) from chunks) as chunks
    `;
    return `${row.documents} documents, ${row.chunks} chunks`;
  }));

  checks.push(await run("embeddings", async () => {
    const embedder = getEmbedder();
    const [vector] = await embedder.embed(["net interest income"], "query");
    if (vector.length !== embedding.dimensions) {
      throw new Error(`deployment returned ${vector.length} dims, schema expects ${embedding.dimensions}`);
    }
    return `${embedder.id}, ${vector.length} dims`;
  }));

  checks.push(await run("edgar", async () => {
    const [filing] = await listFilings(CORPUS[0], "10-K", 1);
    return `${filing.ticker} FY${filing.fiscalYear} ${filing.accessionNumber}`;
  }));

  for (const check of checks) {
    console.log(`${check.ok ? "ok  " : "FAIL"} ${check.name.padEnd(11)} ${check.detail}`);
  }

  await closeDb();
  process.exit(checks.every((check) => check.ok) ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
