import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL not set");
}

// Single shared connection pool for the whole process. postgres.js manages
// pooling; `prepare: false` keeps it compatible with transaction-pooling
// endpoints (Neon's -pooler / PgBouncer) and is harmless on a direct
// Railway Postgres connection. Exported so the raw-SQL stores
// (ops/monitor-store, whales/ticker-lease, whales/stats-store) share this
// one pool instead of each opening their own.
export const sql = postgres(url, { prepare: false });
export const db = drizzle(sql, { schema });
