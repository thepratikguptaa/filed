import { readFile } from "node:fs/promises";
import { closeDb, db } from "../lib/db";
import { embedding } from "../lib/config";
import { loadDraft, makeAnchor, saveGolden } from "../lib/eval/golden";
import type { GoldenSet, Label } from "../lib/eval/types";

const PROPOSED_PATH = "eval/proposed-labels.json";

async function main() {
  const proposed = JSON.parse(await readFile(PROPOSED_PATH, "utf8")) as Record<string, string[]>;
  const draft = await loadDraft();
  const wanted = [...new Set(Object.values(proposed).flat())];

  const rows = await db()<{ id: string; document_id: string; section: string | null; text: string }[]>`
    select id, document_id, section, text from chunks where id = any(${wanted})
  `;
  const byId = new Map(rows.map((row) => [row.id, row]));

  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`unknown chunk ids: ${missing.join(", ")}`);

  const questions = draft.map((question) => {
    const ids = proposed[question.id] ?? [];
    const labels: Label[] = ids.map((id) => {
      const row = byId.get(id)!;
      return { chunkId: row.id, documentId: row.document_id, section: row.section, anchor: makeAnchor(row.text) };
    });
    return { ...question, labels, labelledAt: labels.length > 0 ? new Date().toISOString() : undefined };
  });

  const set: GoldenSet = { version: 1, embedder: embedding.model, labelledBy: "model", questions };
  await saveGolden(set);

  const labelled = questions.filter((question) => question.labels.length > 0);
  console.log(`${labelled.length}/${questions.length} questions labelled, ${wanted.length} distinct chunks`);
  for (const category of new Set(labelled.map((question) => question.category))) {
    console.log(`  ${category}: ${labelled.filter((question) => question.category === category).length}`);
  }
  const unlabelled = questions.filter((question) => question.labels.length === 0).map((question) => question.id);
  if (unlabelled.length > 0) console.log(`  unlabelled: ${unlabelled.join(", ")}`);

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
