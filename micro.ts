import { pipeline, env as hfEnv } from "@huggingface/transformers";
hfEnv.cacheDir = "data/models";

const SHORT = Array.from({ length: 8 }, (_, i) => `search_document: quarterly net revenue increased in segment ${i}`);
const LONG = Array.from({ length: 8 }, (_, i) => `search_document: ${"the company reported material risks related to supply chain and regulation. ".repeat(60)} ${i}`);

async function bench(model: string, dtype: any) {
  const t0 = Date.now();
  const p = await pipeline("feature-extraction", model, { dtype });
  const load = ((Date.now() - t0) / 1000).toFixed(1);

  const t1 = Date.now();
  const o = await p(SHORT, { pooling: "mean", normalize: true });
  const shortS = ((Date.now() - t1) / 1000).toFixed(1);

  const t2 = Date.now();
  await p(LONG, { pooling: "mean", normalize: true });
  const longS = ((Date.now() - t2) / 1000).toFixed(1);

  console.log(`${model} [${dtype}] load=${load}s  8short=${shortS}s  8long(~750tok)=${longS}s  dims=${(o.tolist() as number[][])[0].length}`);
}

async function main() {
  await bench("Xenova/all-MiniLM-L6-v2", "q8");
  await bench("nomic-ai/nomic-embed-text-v1.5", "q8");
}
main().catch((e) => console.log("ERR", e.message));
