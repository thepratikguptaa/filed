import { writeFile } from "node:fs/promises";
import { closeDb } from "../lib/db";
import { appendFaithfulness, formatFaithfulness, runFaithfulness } from "../lib/eval/faithfulness";
import { labelledQuestions, loadGolden } from "../lib/eval/golden";
import type { RetrievalStrategy } from "../lib/retrieve";

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const strategy = (flag("strategy") ?? "hybrid+rerank") as RetrievalStrategy;
  const golden = await loadGolden();
  const questions = labelledQuestions(golden);

  if (questions.length === 0) {
    console.error("No labelled questions yet. Run `npm run label` first.");
    process.exit(1);
  }

  const limit = flag("limit") ? Number(flag("limit")) : questions.length;
  const report = await runFaithfulness(questions.slice(0, limit), {
    strategy,
    k: flag("k") ? Number(flag("k")) : undefined,
    onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}`),
  });
  process.stdout.write("\r");

  console.log(`\n${formatFaithfulness(report)}\n`);

  const detail = flag("out") ?? "eval/faithfulness.latest.json";
  await writeFile(detail, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${detail}`);

  if (!process.argv.includes("--no-history")) {
    await appendFaithfulness(report);
    console.log("appended to eval/faithfulness.jsonl");
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
