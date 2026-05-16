// lib/bots/ticker-lease.ts
//
// Single-row distributed lease so that EXACTLY ONE process ticks the
// bot resolver at a time — even though dev and prod share one Neon
// database. Without this, running `npm run dev` locally while the
// Railway prod app is up would double-tick the arena: duplicate
// positions, dedup races, balances drifting twice as fast.
//
// The lease is one row in `ticker_lease`. The holder renews it on
// every loop iteration; if the holder dies, the row goes stale after
// LEASE_TTL_SECONDS and any other process can claim it. Self-
// provisioning — ensureLeaseTable() runs an idempotent CREATE TABLE,
// so there is no manual migration step on dev or prod.

import { neon } from "@neondatabase/serverless";

// Lease validity window. Must comfortably exceed one full loop cycle
// (tick duration + gap, currently ~50s) so a healthy holder never
// lets its own lease lapse. On holder death, failover takes this long.
const LEASE_TTL_SECONDS = 180;

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  return neon(url);
}

/** Create the lease table if missing. Idempotent — safe every boot. */
export async function ensureLeaseTable(): Promise<void> {
  const sql = client();
  await sql`
    CREATE TABLE IF NOT EXISTS ticker_lease (
      id           integer PRIMARY KEY,
      holder       text NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Atomically claim or renew the lease. Returns true if THIS holder now
 * owns it. One INSERT ... ON CONFLICT does the whole thing in a single
 * round-trip:
 *   - no row yet                     → INSERT runs, we own it
 *   - row is already ours, or stale  → UPDATE runs, we own it
 *   - row is someone else's & fresh  → WHERE fails, nothing returned
 */
export async function acquireTickerLease(holder: string): Promise<boolean> {
  const sql = client();
  const rows = (await sql`
    INSERT INTO ticker_lease (id, holder, heartbeat_at)
    VALUES (1, ${holder}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, heartbeat_at = now()
      WHERE ticker_lease.holder = ${holder}
         OR ticker_lease.heartbeat_at
              < now() - make_interval(secs => ${LEASE_TTL_SECONDS})
    RETURNING holder
  `) as Array<{ holder: string }>;
  return rows.length > 0;
}
