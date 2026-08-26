import { closeDb, withRetry } from "../lib/db";
import { labelledQuestions, loadGolden, normalize } from "../lib/eval/golden";

async function main() {
  const golden = await loadGolden();
  const questions = labelledQuestions(golden);

  const corpus: { id: string; flat: string }[] = [];
  const pageSize = 800;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await withRetry((sql) => sql<{ id: string; text: string }[]>`
      select id, text from chunks order by id limit ${pageSize} offset ${offset}
    `);
    if (rows.length === 0) break;
    for (const row of rows) corpus.push({ id: row.id, flat: normalize(row.text) });
  }
  console.log(`corpus: ${corpus.length} chunks`);

  let matched = 0;
  let total = 0;
  const broken: { question: string; anchor: string; oldId: string }[] = [];

  for (const question of questions) {
    for (const label of question.labels) {
      total += 1;
      const hit = corpus.find((chunk) => chunk.id === label.chunkId || chunk.flat.includes(label.anchor));
      if (hit) matched += 1;
      else broken.push({ question: question.id, anchor: label.anchor, oldId: label.chunkId });
    }
  }

  console.log(`${matched}/${total} labels resolve to a chunk in the current corpus`);
  const affected = new Set(broken.map((entry) => entry.question));
  if (broken.length > 0) {
    console.log(`\n${broken.length} broken label(s) across ${affected.size} question(s):`);
    for (const entry of broken) {
      console.log(`  ${entry.question}  was ${entry.oldId}`);
      console.log(`    anchor: ${entry.anchor.slice(0, 90)}...`);
    }
  }

  const orphaned = questions.filter((question) =>
    question.labels.every((label) =>
      !corpus.some((chunk) => chunk.id === label.chunkId || chunk.flat.includes(label.anchor)),
    ),
  );
  if (orphaned.length > 0) {
    console.log(`\nquestions with NO resolvable label: ${orphaned.map((q) => q.id).join(", ")}`);
  }

  await closeDb();
  process.exit(broken.length > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
