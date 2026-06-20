// One-off, additive: create the session_keys table (matches lib/db/schema.ts).
// CREATE TABLE IF NOT EXISTS — never touches paper_positions / bots / balances.
// node --env-file=.env.local scripts/_create-session-keys-table.mjs
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// Show what exists BEFORE (proves we don't drop anything).
const before = await sql`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'public' and table_name = 'session_keys'`;
console.log(`BEFORE: session_keys exists = ${before[0].n > 0}`);

await sql`
  CREATE TABLE IF NOT EXISTS session_keys (
    user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    main_pubkey        text NOT NULL,
    session_pubkey     text NOT NULL UNIQUE,
    session_secret_enc text NOT NULL,
    session_token_pda  text NOT NULL,
    valid_until        timestamptz NOT NULL,
    bound_at           timestamptz
  )`;

// Verify the table + columns landed.
const cols = await sql`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'session_keys'
  order by ordinal_position`;
const rowCount = await sql`select count(*)::int as n from session_keys`;

console.log(`AFTER: session_keys columns:`);
for (const c of cols) {
  console.log(`  ${c.column_name.padEnd(20)} ${c.data_type} ${c.is_nullable === "YES" ? "NULL" : "NOT NULL"}`);
}
console.log(`AFTER: session_keys row count = ${rowCount[0].n} (expected 0)`);

// Sanity: paper_positions + bots are still present and untouched.
const guard = await sql`
  select
    (select count(*)::int from information_schema.tables where table_name='paper_positions') as paper_positions_table,
    (select count(*)::int from bots) as bots_rows`;
console.log(`GUARD: paper_positions table present = ${guard[0].paper_positions_table > 0}, bots rows = ${guard[0].bots_rows}`);

await sql.end();
