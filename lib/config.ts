import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

function resourceOrigin(value: string): string {
  return new URL(value).origin;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get azureEndpoint() {
    return resourceOrigin(required("AZURE_OPENAI_ENDPOINT"));
  },
  get azureApiKey() {
    return required("AZURE_OPENAI_API_KEY");
  },
  get azureApiVersion() {
    return required("AZURE_OPENAI_API_VERSION");
  },
  get azureEmbeddingDeployment() {
    return required("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
  },
  get secUserAgent() {
    return required("SEC_USER_AGENT");
  },
};

export type EmbeddingProvider = "local" | "azure";

const EMBEDDING_PROVIDERS = {
  local: { model: "nomic-ai/nomic-embed-text-v1.5", dimensions: 768, batchSize: 16 },
  azure: { model: "text-embedding-3-small", dimensions: 1536, batchSize: 96 },
} as const;

export const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? "local") as EmbeddingProvider;

export const embedding = EMBEDDING_PROVIDERS[embeddingProvider];

export const chunking = {
  targetTokens: 700,
  overlapTokens: 100,
  minTokens: 40,
  maxTokens: 1200,
};

export const paths = {
  rawCache: "data/raw",
};
