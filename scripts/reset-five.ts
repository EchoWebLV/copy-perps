// scripts/reset-five.ts
//
// Resets the paper-bot arena to a 5-bot test setup:
//   • Surge  (momo-max-aggressive)  — smarter v2, BTC/ETH/SOL, dyn lev 6-18x
//   • Fade   (mean-revert-mike)     — smarter v2, BTC/ETH/SOL, dyn lev 5-15x
//   • Bolt   (vol-vector-hair-trigger) — smarter v2, BTC/ETH/SOL, dyn lev 6-14x
//   • Anti-Surge — mirrors Surge, flips side. Same triggers, opposite direction.
//   • Anti-Fade  — mirrors Fade,  flips side. Same triggers, opposite direction.
//
// Wipes ALL paper_positions and deletes every bot row that isn't one
// of the 5 above, then upserts the 5 with fresh $10,000 balances. The
// test thesis: if a base bot has gross loss > round-trip friction, its
// mirror should print. Inversion-pair PnL plotted side-by-side surfaces
// whether each persona has any edge at all.
//
// Safe to run repeatedly.

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const STARTING_BALANCE = 10_000;

const TARGET_BOTS = {
  "momo-max-aggressive": {
    name: "Surge",
    avatarEmoji: "🚀",
    personaVoiceKey: "momo-max",
    strategyKey: "momo-max-aggressive",
    config: {
      timeframe: "1m",
      candleCount: 6,
      breakoutPct: 0.003,
      volumeMultiplier: 1.2,
      exitFavorablePct: 0.003,
      maxHoldMs: 5 * 60 * 1000,
      leverage: 12,
      minLeverage: 6,
      maxLeverage: 18,
      regimesAllowed: [] as string[],
    },
  },
  "mean-revert-mike": {
    name: "Fade",
    avatarEmoji: "🎯",
    personaVoiceKey: "mean-revert-mike",
    strategyKey: "mean-revert-mike",
    config: {
      timeframe: "1m",
      candleCount: 20,
      zEntryThreshold: 2.0,
      exitFavorablePct: 0.003,
      maxHoldMs: 10 * 60 * 1000,
      leverage: 10,
      minLeverage: 5,
      maxLeverage: 15,
      regimesAllowed: [] as string[],
    },
  },
  "vol-vector-hair-trigger": {
    name: "Bolt",
    avatarEmoji: "💥",
    personaVoiceKey: "vol-vector",
    strategyKey: "vol-vector-hair-trigger",
    config: {
      recentTimeframe: "1m",
      recentCount: 5,
      baselineTimeframe: "1m",
      baselineCount: 30,
      volMultiplier: 1.5,
      trendConsistencyMin: 0.5,
      exitFavorablePct: 0.004,
      maxHoldMs: 6 * 60 * 1000,
      leverage: 10,
      minLeverage: 6,
      maxLeverage: 14,
      regimesAllowed: [] as string[],
    },
  },
  "anti-surge": {
    name: "Anti-Surge",
    avatarEmoji: "🪞",
    personaVoiceKey: "anti-surge",
    strategyKey: "anti-surge",
    config: {
      inverseOf: "momo-max-aggressive",
    },
  },
  "anti-fade": {
    name: "Anti-Fade",
    avatarEmoji: "🪞",
    personaVoiceKey: "anti-fade",
    strategyKey: "anti-fade",
    config: {
      inverseOf: "mean-revert-mike",
    },
  },
} as const;

const TARGET_IDS = Object.keys(TARGET_BOTS);

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const before = (await sql`
    SELECT
      (SELECT COUNT(*) FROM paper_positions) AS positions,
      (SELECT COUNT(*) FROM bots) AS bots
  `) as Array<{ positions: number; bots: number }>;
  console.log("BEFORE:", before[0]);

  // 1. Wipe all positions. Clean slate for a fair 24h test.
  const deletedPositions = await sql`DELETE FROM paper_positions RETURNING id`;
  console.log(`Deleted ${deletedPositions.length} paper_positions rows.`);

  // 2. Drop any bot that isn't in the target set. FKs on bot_chats /
  // bot_thoughts cascade.
  const droppedBots = await sql`
    DELETE FROM bots
    WHERE id NOT IN (
      'momo-max-aggressive', 'mean-revert-mike', 'vol-vector-hair-trigger',
      'anti-surge', 'anti-fade'
    )
    RETURNING id
  `;
  if (droppedBots.length > 0) {
    console.log(
      `Deleted ${droppedBots.length} stale bot rows:`,
      droppedBots.map((r) => r.id),
    );
  }

  // 3. Upsert each target bot with fresh state.
  for (const [botId, spec] of Object.entries(TARGET_BOTS)) {
    const result = await sql`
      INSERT INTO bots (
        id, parent_id, name, avatar_emoji, persona_voice_key,
        strategy_key, config, status, balance_usd, starting_balance_usd
      ) VALUES (
        ${botId},
        NULL,
        ${spec.name},
        ${spec.avatarEmoji},
        ${spec.personaVoiceKey},
        ${spec.strategyKey},
        ${JSON.stringify(spec.config)}::jsonb,
        'paper',
        ${STARTING_BALANCE},
        ${STARTING_BALANCE}
      )
      ON CONFLICT (id) DO UPDATE SET
        parent_id = NULL,
        name = EXCLUDED.name,
        avatar_emoji = EXCLUDED.avatar_emoji,
        persona_voice_key = EXCLUDED.persona_voice_key,
        strategy_key = EXCLUDED.strategy_key,
        config = EXCLUDED.config,
        status = 'paper',
        balance_usd = ${STARTING_BALANCE},
        starting_balance_usd = ${STARTING_BALANCE}
      RETURNING id, name, balance_usd, status
    `;
    const row = result[0];
    if (!row) {
      console.log(`  ⚠ ${botId} upsert returned no rows`);
    } else {
      console.log(
        `  ✓ ${botId} → name="${row.name}" balance=$${row.balance_usd} status=${row.status}`,
      );
    }
  }

  const after = (await sql`
    SELECT id, name, balance_usd, status FROM bots ORDER BY id
  `) as Array<{ id: string; name: string; balance_usd: number; status: string }>;
  console.log("\nAFTER:");
  console.table(after);

  const remainingPositions = (await sql`
    SELECT COUNT(*) AS n FROM paper_positions
  `) as Array<{ n: number }>;
  console.log(`Remaining open positions: ${remainingPositions[0].n}`);
  console.log(
    `\nTest start: ${new Date().toISOString()} — let the resolver run for 24h.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
