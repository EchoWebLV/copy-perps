// One-shot migration: walk every closed prediction bet whose
// proceeds_usdc is missing/zero (the old code stored 0 because it
// trusted Jupiter's order spend rather than the on-chain settlement)
// and persist the real net proceeds.
//
// Strategy: the bet's close_tx_hash is the order_create signature, but
// the actual fill (and netProceedsUsd) lands in a separate keeper-sent
// tx. Pull each user's full Jupiter Prediction history, match the
// stored close_tx_hash to its order_created event to recover the
// orderPubkey, then look up the corresponding order_filled event for
// the real netProceedsUsd.
//
// Usage:
//   DATABASE_URL=... node scripts/backfill-prediction-pnl.mjs
//   DRY_RUN=1 to preview without writing.

import { neon } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("set DATABASE_URL"); process.exit(1); }
const DRY = process.env.DRY_RUN === "1";

const PREDICTION_API = "https://prediction-market-api.jup.ag/api/v1";
const sql = neon(DB_URL);

async function fetchAllHistory(ownerPubkey) {
  const out = [];
  // Paginate via `end` cursor (descending). Stop when fewer than `limit`
  // returned (ran out) or when we've retrieved more than 1000 events.
  let end;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ ownerPubkey, limit: "100" });
    if (end) qs.set("end", String(end));
    const r = await fetch(`${PREDICTION_API}/history?${qs}`);
    if (!r.ok) throw new Error(`history ${r.status}: ${await r.text()}`);
    const data = (await r.json()).data ?? [];
    out.push(...data);
    if (data.length < 100) break;
    end = data[data.length - 1].timestamp;
  }
  return out;
}

const rows = await sql`
  SELECT b.id, b.amount_usdc, b.close_tx_hash, b.user_id, u.solana_pubkey
  FROM bets b
  JOIN users u ON u.id = b.user_id
  WHERE b.type = 'prediction'
    AND b.status = 'closed'
    AND b.close_tx_hash IS NOT NULL
    AND (b.proceeds_usdc IS NULL OR b.proceeds_usdc = 0)
  ORDER BY b.created_at DESC
`;

console.log(`Found ${rows.length} prediction bets to backfill\n`);

// Cache per-user history fetches to avoid hammering the API.
const historyByOwner = new Map();
async function getHistory(owner) {
  if (!historyByOwner.has(owner)) {
    historyByOwner.set(owner, await fetchAllHistory(owner));
  }
  return historyByOwner.get(owner);
}

let fixed = 0;
let skipped = 0;
for (const row of rows) {
  const owner = row.solana_pubkey;
  const closeSig = row.close_tx_hash;

  let history;
  try {
    history = await getHistory(owner);
  } catch (e) {
    console.log(`  ${row.id}  history fetch err: ${e.message}`);
    skipped++;
    continue;
  }

  const created = history.find(
    (h) => h.signature === closeSig && h.eventType === "order_created",
  );
  if (!created) {
    console.log(
      `  ${row.id}  close_tx ${closeSig.slice(0, 12)}.. not in history`,
    );
    skipped++;
    continue;
  }

  const filled = history.find(
    (h) =>
      h.orderPubkey === created.orderPubkey &&
      h.eventType === "order_filled",
  );
  if (!filled) {
    console.log(
      `  ${row.id}  no order_filled for orderPubkey ${created.orderPubkey.slice(0, 12)}..`,
    );
    skipped++;
    continue;
  }

  const proceedsAtomic = BigInt(filled.netProceedsUsd ?? 0);
  if (proceedsAtomic === 0n) {
    console.log(`  ${row.id}  fill has zero netProceedsUsd`);
    skipped++;
    continue;
  }

  const proceedsUsd = Number(proceedsAtomic) / 1_000_000;
  const cost = Number(row.amount_usdc);
  const pnl = proceedsUsd - cost;
  const pnlPct = (pnl / cost) * 100;

  console.log(
    `  ${row.id}  cost $${cost.toFixed(2)} → proceeds $${proceedsUsd.toFixed(
      2,
    )}  pnl ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`,
  );

  if (!DRY) {
    await sql`
      UPDATE bets SET proceeds_usdc = ${proceedsUsd} WHERE id = ${row.id}
    `;
  }
  fixed++;
}

console.log(
  `\n${DRY ? "[dry run] would have fixed" : "fixed"} ${fixed}, skipped ${skipped}`,
);
