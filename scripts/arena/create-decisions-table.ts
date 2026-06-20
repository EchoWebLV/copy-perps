// scripts/arena/create-decisions-table.ts
//
// One-off, idempotent DDL for the `arena_decisions` table (the LLM "AI thought"
// store). Scoped on purpose: it ONLY creates this table + its indexes via
// CREATE ... IF NOT EXISTS, and touches NOTHING else (no paper_positions, no
// bots, no balances). Safe to re-run. Matches the drizzle definition in
// lib/db/schema.ts exactly.
//
//   npx tsx --env-file=.env.local scripts/arena/create-decisions-table.ts

import { sql } from "../../lib/db";

async function main() {
  // gen_random_uuid() lives in pgcrypto (Neon ships it; enabling is idempotent).
  await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS arena_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      persona text NOT NULL,
      market_id integer NOT NULL DEFAULT 0,
      action text NOT NULL,
      side text,
      asset text,
      leverage integer,
      confidence double precision,
      reasoning text NOT NULL,
      sent boolean NOT NULL DEFAULT false,
      reject_reason text,
      signature text,
      tape_ts_ms bigint,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS arena_decisions_persona_ts_idx ON arena_decisions (persona, created_at)`,
  );
  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS arena_decisions_persona_tape_idx ON arena_decisions (persona, tape_ts_ms)`,
  );

  const cols = await sql.unsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'arena_decisions' ORDER BY ordinal_position`,
  );
  const [{ count }] = await sql.unsafe(
    `SELECT count(*)::int AS count FROM arena_decisions`,
  );

  console.log("arena_decisions ready.");
  console.log("columns:", cols.map((c) => c.column_name).join(", "));
  console.log("rows:", count);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
