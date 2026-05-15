// scripts/nuke-to-three.ts
//
// Wipes every paper position + every bot row that isn't one of the 3
// alpha-arena survivors, then renames the 3 survivors (Surge / Fade /
// Bolt), updates their configs to the aggressive values, and resets
// their balance to $1000. Safe to run repeatedly.
//
// The 9 deleted bots' strategies still exist in code (admin can clone
// them back if you want them). Only their DB rows + open positions are
// gone.
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const SURVIVORS = {
  "momo-max-aggressive": {
    name: "Surge",
    config: {
      timeframe: "1m",
      candleCount: 6,
      breakoutPct: 0.001,
      volumeMultiplier: 1.0,
      exitFavorablePct: 0.002,
      maxHoldMs: 5 * 60 * 1000,
      leverage: 30,
      regimesAllowed: [] as string[],
    },
  },
  "mean-revert-mike": {
    name: "Fade",
    config: {
      timeframe: "1m",
      candleCount: 20,
      zEntryThreshold: 1.2,
      exitFavorablePct: 0.003,
      maxHoldMs: 10 * 60 * 1000,
      leverage: 25,
      regimesAllowed: [] as string[],
    },
  },
  "vol-vector-hair-trigger": {
    name: "Bolt",
    config: {
      recentTimeframe: "1m",
      recentCount: 3,
      baselineTimeframe: "15m",
      baselineCount: 12,
      volMultiplier: 1.05,
      trendConsistencyMin: 0.3,
      exitFavorablePct: 0.003,
      maxHoldMs: 6 * 60 * 1000,
      leverage: 35,
      regimesAllowed: [] as string[],
    },
  },
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const before = (await sql`
    SELECT
      (SELECT COUNT(*) FROM paper_positions) AS positions,
      (SELECT COUNT(*) FROM bots) AS bots,
      (SELECT COUNT(*) FROM bots WHERE id NOT IN ('momo-max-aggressive', 'mean-revert-mike', 'vol-vector-hair-trigger')) AS to_delete
  `) as Array<{ positions: number; bots: number; to_delete: number }>;
  console.log("BEFORE:", before[0]);

  // 1. Wipe every position. Cleaner than trying to preserve closed history
  // for bots that are about to be deleted anyway (FK cascade would do
  // some of it, but mixing live + soon-orphan history is confusing).
  const deleted = await sql`DELETE FROM paper_positions RETURNING id`;
  console.log(`Deleted ${deleted.length} paper_positions rows.`);

  // 2. Delete the 9 non-survivor bots. FK on bot_chats cascades.
  const droppedBots = await sql`
    DELETE FROM bots
    WHERE id NOT IN ('momo-max-aggressive', 'mean-revert-mike', 'vol-vector-hair-trigger')
    RETURNING id
  `;
  console.log(`Deleted ${droppedBots.length} bot rows:`, droppedBots.map((r) => r.id));

  // 3. Rename + reconfigure + reset the 3 survivors.
  for (const [botId, spec] of Object.entries(SURVIVORS)) {
    const rows = await sql`
      UPDATE bots
      SET name = ${spec.name},
          parent_id = NULL,
          config = ${JSON.stringify(spec.config)}::jsonb,
          balance_usd = starting_balance_usd,
          status = 'paper'
      WHERE id = ${botId}
      RETURNING id, name, balance_usd, status
    `;
    if (rows.length === 0) {
      console.log(`  ⚠ ${botId} not found in DB`);
    } else {
      console.log(`  ✓ ${botId} → name="${rows[0].name}" balance=$${rows[0].balance_usd}`);
    }
  }

  const after = (await sql`
    SELECT
      (SELECT COUNT(*) FROM paper_positions) AS positions,
      (SELECT COUNT(*) FROM bots) AS bots
  `) as Array<{ positions: number; bots: number }>;
  console.log("AFTER:", after[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
