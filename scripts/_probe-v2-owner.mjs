// Read-only probe: list recent users + dump the live Flash v2 owner snapshot for
// each wallet (basketPubkey = onboarded?, plus whatever balance fields exist).
// No writes, no signing. Run: node --env-file=.env.local scripts/_probe-v2-owner.mjs
import postgres from "postgres";

const REST = process.env.FLASH_V2_REST_BASE ?? "https://flashapi.trade/v2";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const users = await sql`
  select solana_pubkey, privy_id, updated_at
  from users
  where solana_pubkey is not null
  order by updated_at desc nulls last
  limit 8`;

console.log(`REST base: ${REST}`);
console.log(`recent users: ${users.length}`);

for (const u of users) {
  const w = u.solana_pubkey;
  let snap = null;
  try {
    const res = await fetch(`${REST}/owner/${w}`);
    snap = await res.json().catch(() => null);
  } catch (e) {
    snap = { error: String(e) };
  }
  const basket = snap?.basketPubkey ?? null;
  const posCount = snap ? Object.keys(snap.positionMetrics ?? {}).length : "?";
  // Dump the TOP-LEVEL keys so we can see if any balance/ledger field exists.
  const topKeys = snap && typeof snap === "object" ? Object.keys(snap) : [];
  console.log(
    `\n${w}  (updated ${u.updated_at})\n` +
      `  basketPubkey: ${basket ? basket : "NULL (not onboarded)"}\n` +
      `  positions: ${posCount}\n` +
      `  snapshot top-level keys: ${JSON.stringify(topKeys)}`,
  );
  if (topKeys.length && topKeys.length <= 12) {
    // small snapshot — print it so we can read the balance shape
    console.log("  raw:", JSON.stringify(snap).slice(0, 1200));
  }
}

await sql.end();
