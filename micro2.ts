import { pipeline, env as hfEnv } from "@huggingface/transformers";
hfEnv.cacheDir = "data/models";

function texts(n: number, words: number) {
  return Array.from({ length: n }, (_, i) => `search_document: ${"material risk supply chain regulation revenue segment ".repeat(words)} ${i}`);
}

async function bench(label: string, model: string, dtype: any, batches: [string, string[]][]) {
  try {
    const p = await pipeline("feature-extraction", model, { dtype });
    for (const [name, batch] of batches) {
      const t = Date.now();
      await p(batch, { pooling: "mean", normalize: true });
      const s = (Date.now() - t) / 1000;
      console.log(`${label.padEnd(26)} ${name.padEnd(16)} ${s.toFixed(1)}s  (${(s / batch.length).toFixed(2)}s/chunk)`);
    }
  } catch (e: any) { console.log(`${label} FAILED: ${e.message?.slice(0, 120)}`); }
}

async function main() {
  const sets: [string, string[]][] = [
    ["8 x ~180tok", texts(8, 20)],
    ["8 x ~450tok", texts(8, 50)],
    ["8 x ~700tok", texts(8, 80)],
  ];
  await bench("nomic q8", "nomic-ai/nomic-embed-text-v1.5", "q8", sets);
  await bench("bge-small q8", "Xenova/bge-small-en-v1.5", "q8", sets);
  await bench("nomic fp32", "nomic-ai/nomic-embed-text-v1.5", "fp32", sets);
}
main();
