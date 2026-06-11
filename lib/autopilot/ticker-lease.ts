import { sql as pg } from "@/lib/db";

const LEASE_TTL_SECONDS = 180;

function client() {
  return pg;
}

export async function ensureAutopilotLeaseTable(): Promise<void> {
  const sql = client();
  await sql`
    CREATE TABLE IF NOT EXISTS autopilot_ticker_lease (
      id           integer PRIMARY KEY,
      holder       text NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function acquireAutopilotTickerLease(
  holder: string,
): Promise<boolean> {
  const sql = client();
  const rows = (await sql`
    INSERT INTO autopilot_ticker_lease (id, holder, heartbeat_at)
    VALUES (1, ${holder}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, heartbeat_at = now()
      WHERE autopilot_ticker_lease.holder = ${holder}
         OR autopilot_ticker_lease.heartbeat_at
              < now() - make_interval(secs => ${LEASE_TTL_SECONDS})
    RETURNING holder
  `) as Array<{ holder: string }>;
  return rows.length > 0;
}
