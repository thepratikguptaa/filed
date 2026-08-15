import postgres from "postgres";
import { env } from "./config";

let client: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!client) {
    client = postgres(env.databaseUrl, {
      prepare: false,
      max: 4,
      idle_timeout: 20,
      connect_timeout: 30,
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

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
