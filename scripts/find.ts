import { closeDb, db } from "../lib/db";

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const pattern = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!pattern) {
    console.error('usage: npx tsx scripts/find.ts "regex" [--ticker=MSFT] [--year=2025] [--section="Item 1"] [--limit=5]');
    process.exit(1);
  }

  const sql = db();
  const ticker = flag("ticker");
  const year = flag("year");
  const section = flag("section");

  const rows = await sql<{ id: string; ticker: string; fiscal_year: number; section: string | null; text: string }[]>`
    select id, ticker, fiscal_year, section, text
    from chunks
    where text ~* ${pattern}
      ${ticker ? sql`and ticker = any(${ticker.split(",")})` : sql``}
      ${year ? sql`and fiscal_year = any(${year.split(",").map(Number)})` : sql``}
      ${section ? sql`and section = ${section}` : sql``}
    order by ticker, fiscal_year, position
    limit ${Number(flag("limit") ?? 5)}
  `;

  console.log(`${rows.length} match(es) for /${pattern}/`);
  for (const row of rows) {
    console.log(`\n--- ${row.id} | ${row.ticker} FY${row.fiscal_year} | ${row.section ?? "-"}`);
    console.log(row.text.replace(/\s+/g, " ").slice(0, 400));
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
