import { closeDb } from "../lib/db";
import { retrieve } from "../lib/retrieve";

function flag(name: string): string | undefined {
  const entry = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return entry?.split("=")[1];
}

async function main() {
  const query = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!query) {
    console.error('usage: npm run query -- "your question" [--k=5] [--ticker=AAPL,MSFT] [--year=2025] [--section="Item 1A"]');
    process.exit(1);
  }

  const chunks = await retrieve(query, {
    strategy: "vector",
    k: Number(flag("k") ?? 5),
    filters: {
      tickers: flag("ticker")?.split(",").map((value) => value.trim().toUpperCase()),
      fiscalYears: flag("year")?.split(",").map(Number),
      sections: flag("section")?.split(","),
    },
  });

  console.log(`\nquery: ${query}\n`);
  chunks.forEach((chunk, index) => {
    const header = `${index + 1}. [${chunk.score?.toFixed(4)}] ${chunk.ticker} FY${chunk.fiscalYear} ${chunk.section ?? "-"} · ${chunk.id}`;
    console.log(header);
    console.log(`   ${chunk.text.replace(/\s+/g, " ").slice(0, 320)}...\n`);
  });

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
