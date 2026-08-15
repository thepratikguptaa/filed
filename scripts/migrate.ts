import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDb, db } from "../lib/db";

const MIGRATIONS_DIR = "db/migrations";

async function main() {
  const sql = db();
  await sql`create table if not exists migrations (name text primary key, applied_at timestamptz default now())`;

  const applied = new Set(
    (await sql<{ name: string }[]>`select name from migrations`).map((row) => row.name),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    const statements = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    await sql.unsafe(statements);
    await sql`insert into migrations (name) values (${file})`;
    console.log(`apply ${file}`);
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
