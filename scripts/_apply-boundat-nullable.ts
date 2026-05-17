// scripts/_apply-boundat-nullable.ts
//
// One-off, surgical migration: make agent_wallets.bound_at nullable.
// We do NOT use `drizzle-kit push` for this — the live DB has operational
// tables (ticker_lease, signals, ...) that are absent from schema.ts, so a
// push would try to DROP them. This script touches only the one column.
// Idempotent: DROP DEFAULT / DROP NOT NULL on an already-nullable column
// are no-ops.

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE agent_wallets ALTER COLUMN bound_at DROP DEFAULT`;
  await sql`ALTER TABLE agent_wallets ALTER COLUMN bound_at DROP NOT NULL`;
  const cols = (await sql`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'agent_wallets' AND column_name = 'bound_at'
  `) as Array<Record<string, string | null>>;
  console.log("agent_wallets.bound_at →", cols[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
