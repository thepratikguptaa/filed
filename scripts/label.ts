import { createInterface } from "node:readline/promises";
import { closeDb } from "../lib/db";
import { retrieve } from "../lib/retrieve";
import { embedding } from "../lib/config";
import { GOLDEN_PATH, labelFromChunk, loadDraft, loadGolden, saveGolden } from "../lib/eval/golden";
import type { GoldenSet } from "../lib/eval/types";
import type { Chunk } from "../lib/types";

const CANDIDATES = 8;

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

function preview(chunk: Chunk, index: number, selected: boolean): string {
  const mark = selected ? "[x]" : "[ ]";
  const head = `${mark} ${String(index + 1).padStart(2)}. ${chunk.ticker} FY${chunk.fiscalYear} ${(chunk.section ?? "-").padEnd(8)} score ${chunk.score?.toFixed(3)}`;
  const body = chunk.text.replace(/\s+/g, " ").slice(0, 260);
  return `${head}\n     ${body}...`;
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const golden = await loadGolden();
  const draft = await loadDraft();
  const only = flag("id");

  const byId = new Map(golden.questions.map((question) => [question.id, question]));
  for (const question of draft) {
    if (!byId.has(question.id)) byId.set(question.id, { ...question, labels: [] });
  }

  const queue = [...byId.values()]
    .filter((question) => (only ? question.id === only : true))
    .filter((question) => (flag("all") === undefined ? question.labels.length === 0 : true));

  if (queue.length === 0) {
    console.log("Nothing to label. Use --all to revisit labelled questions, or --id=q07 for one.");
    rl.close();
    await closeDb();
    return;
  }

  console.log(`\n${queue.length} question(s) to label. Commands: numbers to toggle, "m" more, "s" save+next, "k" skip, "q" quit.\n`);

  let quit = false;
  let touched = false;

  for (const question of queue) {
    if (quit) break;

    const selected = new Set<string>(question.labels.map((label) => label.chunkId));
    let depth = CANDIDATES;
    let pool = await retrieve(question.question, { strategy: "vector", k: depth });

    for (;;) {
      console.log(`\n${"=".repeat(90)}\n${question.id} [${question.category}]  ${question.question}\n`);
      pool.forEach((chunk, index) => console.log(preview(chunk, index, selected.has(chunk.id))));
      console.log(`\nselected: ${selected.size}`);

      const answer = (await rl.question("> ")).trim().toLowerCase();

      if (answer === "q") {
        quit = true;
        break;
      }
      if (answer === "k") break;

      if (answer === "m") {
        depth += CANDIDATES;
        pool = await retrieve(question.question, { strategy: "vector", k: depth });
        continue;
      }

      if (answer === "s") {
        const inPool = new Set(pool.map((chunk) => chunk.id));
        const kept = question.labels.filter(
          (label) => selected.has(label.chunkId) && !inPool.has(label.chunkId),
        );
        const chosen = pool.filter((chunk) => selected.has(chunk.id)).map(labelFromChunk);
        question.labels = [...kept, ...chosen];
        question.labelledAt = new Date().toISOString();
        byId.set(question.id, question);
        touched = true;
        await saveGolden({
          version: golden.version,
          embedder: embedding.model,
          labelledBy: "human",
          questions: [...byId.values()],
        });
        console.log(`saved ${question.labels.length} label(s) for ${question.id}`);
        break;
      }

      for (const token of answer.split(/[\s,]+/).filter(Boolean)) {
        const index = Number(token) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= pool.length) {
          console.log(`  ignoring "${token}"`);
          continue;
        }
        const id = pool[index].id;
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      }
    }
  }

  const set: GoldenSet = {
    version: golden.version,
    embedder: embedding.model,
    labelledBy: touched ? "human" : golden.labelledBy,
    questions: [...byId.values()],
  };
  await saveGolden(set);
  const done = set.questions.filter((question) => question.labels.length > 0).length;
  console.log(`\n${done}/${set.questions.length} questions labelled -> ${GOLDEN_PATH}`);

  rl.close();
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
