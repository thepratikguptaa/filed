import { closeDb } from "../lib/db";
import { labelledQuestions, loadGolden } from "../lib/eval/golden";
import { appendHistory, formatReport, runEval } from "../lib/eval/runner";
import type { RetrievalStrategy } from "../lib/retrieve";

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const strategy = (flag("strategy") ?? "vector") as RetrievalStrategy;
  const golden = await loadGolden();
  const questions = labelledQuestions(golden);

  if (questions.length === 0) {
    console.error("No labelled questions yet. Run `npm run label` first.");
    process.exit(1);
  }

  const report = await runEval(questions, {
    strategy,
    k: flag("k") ? Number(flag("k")) : undefined,
    candidateK: flag("candidates") ? Number(flag("candidates")) : undefined,
    rrfK: flag("rrfk") ? Number(flag("rrfk")) : undefined,
    goldenVersion: golden.version,
    onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}`),
  });
  process.stdout.write("\r");

  console.log(`\n${formatReport(report)}\n`);

  if (!process.argv.includes("--no-history")) {
    await appendHistory(report);
    console.log("appended to eval/history.jsonl");
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
