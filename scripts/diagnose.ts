import { closeDb } from "../lib/db";
import { isRelevant, labelledQuestions, loadGolden } from "../lib/eval/golden";
import { retrieve, type RetrievalStrategy } from "../lib/retrieve";

const DEPTH = 200;
const STRATEGIES: RetrievalStrategy[] = ["vector", "keyword", "hybrid"];

function flag(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const only = flag("id")?.split(",");
  const golden = await loadGolden();
  const questions = labelledQuestions(golden).filter((q) => (only ? only.includes(q.id) : true));

  console.log(`rank of first labelled chunk within top ${DEPTH} (— = absent)\n`);
  console.log(`${"id".padEnd(5)}${"vector".padStart(8)}${"keyword".padStart(9)}${"hybrid".padStart(8)}  question`);

  for (const question of questions) {
    const ranks: Record<string, string> = {};
    for (const strategy of STRATEGIES) {
      const chunks = await retrieve(question.question, { strategy, k: DEPTH, candidateK: DEPTH });
      const index = chunks.findIndex((chunk) => isRelevant(chunk, question.labels));
      ranks[strategy] = index === -1 ? "—" : String(index + 1);
    }
    const line =
      question.id.padEnd(5) +
      ranks.vector.padStart(8) +
      ranks.keyword.padStart(9) +
      ranks.hybrid.padStart(8);
    console.log(`${line}  ${question.question.slice(0, 62)}`);
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
