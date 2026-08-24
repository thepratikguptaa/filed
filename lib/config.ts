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

export type EmbeddingProvider = "bge" | "nomic" | "azure";

interface EmbeddingConfig {
  kind: "local" | "azure";
  model: string;
  dimensions: number;
  batchSize: number;
  maxInputTokens: number;
  pooling: "cls" | "mean";
  prefixes: { document: string; query: string };
}

const EMBEDDING_PROVIDERS: Record<EmbeddingProvider, EmbeddingConfig> = {
  bge: {
    kind: "local",
    model: "Xenova/bge-small-en-v1.5",
    dimensions: 384,
    batchSize: 32,
    maxInputTokens: 512,
    pooling: "cls",
    prefixes: { document: "", query: "Represent this sentence for searching relevant passages: " },
  },
  nomic: {
    kind: "local",
    model: "nomic-ai/nomic-embed-text-v1.5",
    dimensions: 768,
    batchSize: 16,
    maxInputTokens: 8192,
    pooling: "mean",
    prefixes: { document: "search_document: ", query: "search_query: " },
  },
  azure: {
    kind: "azure",
    model: "text-embedding-3-small",
    dimensions: 1536,
    batchSize: 96,
    maxInputTokens: 8191,
    pooling: "mean",
    prefixes: { document: "", query: "" },
  },
};

export const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? "bge") as EmbeddingProvider;

export const embedding = EMBEDDING_PROVIDERS[embeddingProvider];

const CHUNK_HEADROOM = 12;

const hardLimit = embedding.maxInputTokens - CHUNK_HEADROOM;

export const chunking = {
  targetTokens: Math.min(400, hardLimit - 60),
  overlapTokens: 60,
  minTokens: 40,
  maxTokens: hardLimit,
};

export const paths = {
  rawCache: "data/raw",
  modelCache: "data/models",
};
