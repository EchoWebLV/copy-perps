// scripts/reset-eleven.ts
//
// Resets the paper-bot arena to the 11-bot test setup:
//
//   Technical traders (base):
//     • Surge  (momo-max-aggressive)        smarter v2, BTC/ETH/SOL, dyn 6-18x
//     • Fade   (mean-revert-mike)           smarter v2, BTC/ETH/SOL, dyn 5-15x
//     • Bolt   (vol-vector-hair-trigger)    smarter v2, BTC/ETH/SOL, dyn 6-14x
//
//   Mirror tests:
//     • Anti-Surge — flips Surge's side. Same trigger, opposite direction.
//     • Anti-Fade  — flips Fade's side.  Same trigger, opposite direction.
//
//   Structural-edge specialists:
//     • Vulture          fades $100M+ liquidation cascades, dyn 8-20x
//     • Sniper           fades funding extremes >0.5%/8h, dyn 4-12x
//     • Contrarian       fades roster consensus (≥3 bots same side), dyn 5-12x
//     • Shadow           copies curated HL whale opens ≥$500k, dyn 5-15x
//
//   LLM-driven traders:
//     • Grok   — xAI grok-4.3, 5-min eval cooldown, dyn 3-15x
//     • Claude — Anthropic claude-opus-4-7, 5-min eval cooldown, dyn 3-15x
//
// Wipes ALL paper_positions, deletes every bot row not in the target
// set, then upserts the 11 with fresh $10,000 balances. Safe to rerun.

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
    config: { inverseOf: "momo-max-aggressive" },
  },
  "anti-fade": {
    name: "Anti-Fade",
    avatarEmoji: "🪞",
    personaVoiceKey: "anti-fade",
    strategyKey: "anti-fade",
    config: { inverseOf: "mean-revert-mike" },
  },
  vulture: {
    name: "Vulture",
    avatarEmoji: "🦅",
    personaVoiceKey: "vulture",
    strategyKey: "vulture",
    config: {
      cascadeWindowMs: 60 * 1000,
      minCascadeNotionalUsd: 100_000_000,
      exitFavorablePct: 0.008,
      maxHoldMs: 60 * 60 * 1000,
      leverage: 12,
      minLeverage: 8,
      maxLeverage: 20,
    },
  },
  "funding-sniper": {
    name: "Sniper",
    avatarEmoji: "🎯",
    personaVoiceKey: "funding-sniper",
    strategyKey: "funding-sniper",
    config: {
      fundingExtremeThreshold: 0.005,
      minVenueAgreement: 3,
      exitFavorablePct: 0.005,
      maxHoldMs: 4 * 60 * 60 * 1000,
      leverage: 8,
      minLeverage: 4,
      maxLeverage: 12,
    },
  },
  contrarian: {
    name: "Contrarian",
    avatarEmoji: "🪞",
    personaVoiceKey: "contrarian",
    strategyKey: "contrarian",
    config: {
      minConsensusCount: 3,
      exitFavorablePct: 0.005,
      maxHoldMs: 60 * 60 * 1000,
      leverage: 8,
      minLeverage: 5,
      maxLeverage: 12,
    },
  },
  "whale-shadow": {
    name: "Shadow",
    avatarEmoji: "🐋",
    personaVoiceKey: "whale-shadow",
    strategyKey: "whale-shadow",
    config: {
      minNotionalUsd: 500_000,
      freshnessMs: 4 * 60 * 1000,
      exitFavorablePct: 0.012,
      exitAdverseStopPct: 0.008,
      maxHoldMs: 4 * 60 * 60 * 1000,
      leverage: 10,
      minLeverage: 5,
      maxLeverage: 15,
    },
  },
  "grok-trader": {
    name: "Grok",
    avatarEmoji: "🤖",
    personaVoiceKey: "grok-trader",
    strategyKey: "grok-trader",
    config: {
      provider: "xai",
      modelId: "grok-4.3",
      evalCooldownMs: 5 * 60 * 1000,
      maxHoldMs: 4 * 60 * 60 * 1000,
      exitAdverseStopPct: 0.012,
      defaultLeverage: 8,
      minLeverage: 3,
      maxLeverage: 15,
    },
  },
  "claude-trader": {
    name: "Claude",
    avatarEmoji: "🧠",
    personaVoiceKey: "claude-trader",
    strategyKey: "claude-trader",
    config: {
      provider: "anthropic",
      modelId: "claude-opus-4-7",
      evalCooldownMs: 5 * 60 * 1000,
      maxHoldMs: 4 * 60 * 60 * 1000,
      exitAdverseStopPct: 0.012,
      defaultLeverage: 8,
      minLeverage: 3,
      maxLeverage: 15,
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

  const deletedPositions = await sql`DELETE FROM paper_positions RETURNING id`;
  console.log(`Deleted ${deletedPositions.length} paper_positions rows.`);

  const idList = TARGET_IDS.map((id) => `'${id}'`).join(", ");
  const droppedBots = (await sql.query(
    `DELETE FROM bots WHERE id NOT IN (${idList}) RETURNING id`,
  )) as Array<{ id: string }>;
  if (droppedBots.length > 0) {
    console.log(
      `Deleted ${droppedBots.length} stale bot rows:`,
      droppedBots.map((r) => r.id),
    );
  }

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
        `  ✓ ${botId.padEnd(28)} name="${String(row.name).padEnd(12)}" balance=$${row.balance_usd}`,
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
