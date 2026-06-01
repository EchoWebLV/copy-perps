// Durable backing store for the whale roster stats cache.
//
// Lives in Neon Postgres (one JSONB row) rather than the per-container file/
// Redis cache, so the last-good roster stats SURVIVE A DEPLOY. Without this,
// every redeploy wipes the cache and the roster shows "+$0" until the slow,
// rate-limited enriched build re-warms. Self-provisioning: ensureTable() runs
// an idempotent CREATE TABLE, mirroring lib/bots/ticker-lease.ts — no migration.

import { neon } from "@neondatabase/serverless";
import type { WhaleTraderSignal } from "@/lib/types";

type WhaleTraderStats = WhaleTraderSignal["payload"]["stats"];
export type StatsByWhaleId = Record<string, WhaleTraderStats>;

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await client()`
        CREATE TABLE IF NOT EXISTS whale_stats_cache (
          id         integer PRIMARY KEY,
          stats      jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
    })().catch((err) => {
      ensured = null; // let the next call retry table creation
      throw err;
    });
  }
  return ensured;
}

export async function loadStatsBlob(): Promise<StatsByWhaleId> {
  await ensureTable();
  const rows = (await client()`
    SELECT stats FROM whale_stats_cache WHERE id = 1
  `) as Array<{ stats: StatsByWhaleId }>;
  return rows[0]?.stats ?? {};
}

export async function saveStatsBlob(blob: StatsByWhaleId): Promise<void> {
  await ensureTable();
  const json = JSON.stringify(blob);
  await client()`
    INSERT INTO whale_stats_cache (id, stats, updated_at)
    VALUES (1, ${json}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET stats = ${json}::jsonb, updated_at = now()
  `;
}

export async function clearStatsBlob(): Promise<void> {
  await client()`DELETE FROM whale_stats_cache WHERE id = 1`;
}
