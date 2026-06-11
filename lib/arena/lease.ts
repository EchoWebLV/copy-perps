// lib/arena/lease.ts
//
// Crank lease for the on-chain arena: exactly one process may tick the ER.
// Deliberate near-copy of lib/autopilot/ticker-lease.ts (NOT shared code):
// the two leases must be independently droppable, and dev runs + the Railway
// arena worker share one Neon DB, so the CAS upsert is mandatory.

import { sql as pg } from "@/lib/db";

const LEASE_TTL_SECONDS = 180;

function client() {
  return pg;
}

export async function ensureArenaLeaseTable(): Promise<void> {
  const sql = client();
  await sql`
    CREATE TABLE IF NOT EXISTS arena_crank_lease (
      id           integer PRIMARY KEY,
      holder       text NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function acquireArenaCrankLease(holder: string): Promise<boolean> {
  const sql = client();
  const rows = (await sql`
    INSERT INTO arena_crank_lease (id, holder, heartbeat_at)
    VALUES (1, ${holder}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, heartbeat_at = now()
      WHERE arena_crank_lease.holder = ${holder}
         OR arena_crank_lease.heartbeat_at
              < now() - make_interval(secs => ${LEASE_TTL_SECONDS})
    RETURNING holder
  `) as Array<{ holder: string }>;
  return rows.length > 0;
}
