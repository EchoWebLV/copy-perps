import { sql as pg } from "@/lib/db";

const LEASE_TTL_SECONDS = 180;

function client() {
  return pg;
}

export async function ensureWhaleLeaseTable(): Promise<void> {
  const sql = client();
  await sql`
    CREATE TABLE IF NOT EXISTS whale_ticker_lease (
      id           integer PRIMARY KEY,
      holder       text NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function acquireWhaleTickerLease(
  holder: string,
): Promise<boolean> {
  const sql = client();
  const rows = (await sql`
    INSERT INTO whale_ticker_lease (id, holder, heartbeat_at)
    VALUES (1, ${holder}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, heartbeat_at = now()
      WHERE whale_ticker_lease.holder = ${holder}
         OR whale_ticker_lease.heartbeat_at
              < now() - make_interval(secs => ${LEASE_TTL_SECONDS})
    RETURNING holder
  `) as Array<{ holder: string }>;
  return rows.length > 0;
}
