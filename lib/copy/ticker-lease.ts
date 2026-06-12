import { sql as pg } from "@/lib/db";

const LEASE_TTL_SECONDS = 180;

export async function ensureCopyLeaseTable(): Promise<void> {
  await pg`
    CREATE TABLE IF NOT EXISTS copy_ticker_lease (
      id           integer PRIMARY KEY,
      holder       text NOT NULL,
      heartbeat_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function acquireCopyTickerLease(holder: string): Promise<boolean> {
  const rows = (await pg`
    INSERT INTO copy_ticker_lease (id, holder, heartbeat_at)
    VALUES (1, ${holder}, now())
    ON CONFLICT (id) DO UPDATE
      SET holder = ${holder}, heartbeat_at = now()
      WHERE copy_ticker_lease.holder = ${holder}
         OR copy_ticker_lease.heartbeat_at
              < now() - make_interval(secs => ${LEASE_TTL_SECONDS})
    RETURNING holder
  `) as Array<{ holder: string }>;
  return rows.length > 0;
}
