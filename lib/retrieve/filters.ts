import type postgres from "postgres";
import type { RetrievalFilters } from "./types";

export function metadataClause(sql: postgres.Sql | postgres.TransactionSql, filters?: RetrievalFilters) {
  let clause = sql`true`;
  if (filters?.tickers?.length) clause = sql`${clause} and ticker = any(${filters.tickers})`;
  if (filters?.fiscalYears?.length) clause = sql`${clause} and fiscal_year = any(${filters.fiscalYears})`;
  if (filters?.sections?.length) clause = sql`${clause} and section = any(${filters.sections})`;
  if (filters?.filingTypes?.length) clause = sql`${clause} and filing_type = any(${filters.filingTypes})`;
  return clause;
}
