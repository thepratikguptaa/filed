import postgres from "postgres";
import { env } from "./config";

let client: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!client) {
    client = postgres(env.databaseUrl, {
      prepare: false,
      max: 4,
      idle_timeout: 120,
      max_lifetime: 60 * 30,
      connect_timeout: 30,
      onnotice: () => {},
    });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}

const TRANSIENT = /ECONNRESET|CONNECTION_CLOSED|CONNECTION_ENDED|Connection terminated|connection closed|socket hang up|ETIMEDOUT|EPIPE/i;

async function resetClient(): Promise<void> {
  const dying = client;
  client = null;
  if (dying) {
    try {
      await dying.end({ timeout: 5 });
    } catch {
      // the connection is already broken; dropping the reference is the point
    }
  }
}

export async function withRetry<T>(run: (sql: postgres.Sql) => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run(db());
    } catch (error) {
      lastError = error;
      const message = `${error instanceof Error ? error.message : ""} ${(error as { code?: string })?.code ?? ""}`;
      if (!TRANSIENT.test(message)) throw error;
      await resetClient();
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
