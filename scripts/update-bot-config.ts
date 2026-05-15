// scripts/update-bot-config.ts
//
// NON-DESTRUCTIVE bot config patcher. Merges new fields into a bot's
// existing `config` JSONB without touching paper_positions, balance,
// or any other column. Used when a strategy's parameters need to
// shift mid-experiment (e.g. lowering stake pct after the math
// changes).
//
// Usage:
//   tsx scripts/update-bot-config.ts
//
// Edit the UPDATES map below before running. Each entry takes a bot
// id and the partial config patch to merge in. The script will SHOW
// what's changing for each bot, then commit the patches one row at a
// time.

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const UPDATES: Record<string, Record<string, unknown>> = {
  bullion: {
    strategy: "gold-mean-revert",
    timeframe: "4h",
    candleCount: 24,
    zEntryThreshold: 2.0,
    tpPricePct: 0.008,
    slPricePct: 0.012,
    maxHoldMs: 12 * 60 * 60 * 1000,
    cooldownAfterCloseMs: 60 * 60 * 1000,
    stakePctOverride: 0.5,
    minLeverage: 4,
    maxLeverage: 8,
    // Remove the old scalper-specific fields so the row matches the
    // new strategy's shape. Setting to null deletes via the JSONB
    // patch logic below.
    tpPricePctOld: null,
    slPricePctOld: null,
  },
  atlas: {
    strategy: "overnight-sp500",
    entryHourEt: 16.0,
    exitHourEt: 9.5,
    leverage: 5,
    hardStopPct: 0.015,
    maxHoldMs: 18 * 60 * 60 * 1000,
    cooldownAfterCloseMs: 4 * 60 * 60 * 1000,
    stakePctOverride: 0.5,
  },
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  for (const [botId, patch] of Object.entries(UPDATES)) {
    const rows = (await sql`
      SELECT id, name, config FROM bots WHERE id = ${botId} LIMIT 1
    `) as Array<{ id: string; name: string; config: Record<string, unknown> }>;
    if (rows.length === 0) {
      console.log(`  ⚠ ${botId} not found — SKIPPED`);
      continue;
    }
    const oldConfig = rows[0].config ?? {};
    // Patch semantics: null in patch removes the key. Anything else
    // overwrites.
    const newConfig = { ...oldConfig, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete (newConfig as Record<string, unknown>)[k];
    }
    await sql`
      UPDATE bots
      SET config = ${JSON.stringify(newConfig)}::jsonb
      WHERE id = ${botId}
    `;
    const changedKeys = Object.keys(patch).filter(
      (k) =>
        JSON.stringify(oldConfig[k] ?? null) !==
        JSON.stringify(patch[k] ?? null),
    );
    console.log(`  ✓ ${botId.padEnd(18)} patched (${changedKeys.length} keys changed)`);
    for (const k of changedKeys) {
      const oldV = oldConfig[k] === undefined ? "(absent)" : JSON.stringify(oldConfig[k]);
      const newV = patch[k] === null ? "(deleted)" : JSON.stringify(patch[k]);
      console.log(`     ${k}: ${oldV} → ${newV}`);
    }
  }
  console.log(
    "\nDone. No paper_positions touched. No balances reset. Existing PnL preserved.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
