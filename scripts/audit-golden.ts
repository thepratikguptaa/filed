import { closeDb, withRetry } from "../lib/db";
import { labelledQuestions, loadGolden, normalize, saveGolden, GOLDEN_PATH } from "../lib/eval/golden";
import type { GoldenQuestion, GoldenSet, Label } from "../lib/eval/types";

async function main() {
  const shouldConfirm = process.argv.includes("--confirm-human");
  const shouldFix = process.argv.includes("--fix");

  console.log("=== Golden Set Human Audit & Verification ===");
  const golden = await loadGolden();
  const questions = labelledQuestions(golden);

  console.log(`Loaded ${questions.length} questions with labels (currently labelledBy: "${golden.labelledBy ?? "unknown"}")`);

  // Load all chunks from DB for resolution
  console.log("Loading chunk corpus from Postgres...");
  const corpus: { id: string; documentId: string; section: string | null; text: string; flat: string }[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await withRetry((sql) => sql<{ id: string; document_id: string; section: string | null; text: string }[]>`
      select id, document_id, section, text from chunks order by id limit ${pageSize} offset ${offset}
    `);
    if (rows.length === 0) break;
    for (const row of rows) {
      corpus.push({
        id: row.id,
        documentId: row.document_id,
        section: row.section,
        text: row.text,
        flat: normalize(row.text),
      });
    }
  }
  console.log(`Corpus loaded: ${corpus.length} chunks\n`);

  let perfect = 0;
  let reanchored = 0;
  let missing = 0;
  let totalLabels = 0;

  const auditedQuestions: GoldenQuestion[] = [];

  for (const q of questions) {
    const updatedLabels: Label[] = [];
    let qHasMissing = false;

    console.log(`[${q.id}] (${q.category}) "${q.question}"`);

    for (const label of q.labels) {
      totalLabels += 1;
      // 1. Direct chunkId match
      const direct = corpus.find((c) => c.id === label.chunkId);
      if (direct && direct.flat.includes(normalize(label.anchor))) {
        perfect += 1;
        updatedLabels.push(label);
        console.log(`  ✓ Label ${label.chunkId}: verified in passage`);
        continue;
      }

      // 2. Try anchor match elsewhere in same document
      const normAnchor = normalize(label.anchor);
      const docMatch = corpus.find((c) => c.documentId === label.documentId && c.flat.includes(normAnchor));
      if (docMatch) {
        reanchored += 1;
        console.log(`  ~ Label shifted: ${label.chunkId} -> ${docMatch.id}`);
        updatedLabels.push({
          chunkId: shouldFix ? docMatch.id : label.chunkId,
          documentId: docMatch.documentId,
          section: docMatch.section,
          anchor: label.anchor,
        });
        continue;
      }

      // 3. Try global anchor match
      const anyMatch = corpus.find((c) => c.flat.includes(normAnchor));
      if (anyMatch) {
        reanchored += 1;
        console.log(`  ~ Label found in document ${anyMatch.documentId}: ${anyMatch.id}`);
        updatedLabels.push({
          chunkId: shouldFix ? anyMatch.id : label.chunkId,
          documentId: anyMatch.documentId,
          section: anyMatch.section,
          anchor: label.anchor,
        });
        continue;
      }

      missing += 1;
      qHasMissing = true;
      console.log(`  ✗ Missing chunk/anchor: ${label.chunkId} (${label.anchor.slice(0, 60)}...)`);
      updatedLabels.push(label);
    }

    auditedQuestions.push({
      ...q,
      labels: updatedLabels,
      labelledAt: shouldConfirm || shouldFix ? new Date().toISOString() : q.labelledAt,
    });

    if (!qHasMissing) {
      console.log(`  Status: VALIDATED`);
    } else {
      console.log(`  Status: CONTAINS UNRESOLVED LABELS`);
    }
    console.log();
  }

  console.log("--- Audit Summary ---");
  console.log(`Total labels checked : ${totalLabels}`);
  console.log(`Exact verified       : ${perfect} (${((perfect / totalLabels) * 100).toFixed(1)}%)`);
  console.log(`Shifted / Reanchored : ${reanchored}`);
  console.log(`Unresolved           : ${missing}`);

  if (shouldConfirm) {
    const updatedSet: GoldenSet = {
      ...golden,
      labelledBy: "human",
      questions: auditedQuestions,
    };
    await saveGolden(updatedSet);
    console.log(`\nSUCCESS: Golden set marked as labelledBy: "human" in ${GOLDEN_PATH}`);
  } else if (shouldFix) {
    const updatedSet: GoldenSet = {
      ...golden,
      questions: auditedQuestions,
    };
    await saveGolden(updatedSet);
    console.log(`\nSUCCESS: Updated chunk IDs written to ${GOLDEN_PATH}`);
  } else {
    console.log("\nRun with --confirm-human to approve labels and mark labelledBy: 'human'.");
    console.log("Run with --fix to automatically re-align shifted chunk IDs.");
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error("Audit failed:", err);
  await closeDb();
  process.exit(1);
});
