import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get openaiApiKey() {
    return required("OPENAI_API_KEY");
  },
  get secUserAgent() {
    return required("SEC_USER_AGENT");
  },
};

export const embedding = {
  model: "text-embedding-3-small",
  dimensions: 1536,
  batchSize: 96,
};

export const chunking = {
  targetTokens: 700,
  overlapTokens: 100,
  minTokens: 40,
  maxTokens: 1200,
};

export const paths = {
  rawCache: "data/raw",
};
