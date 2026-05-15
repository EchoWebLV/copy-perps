// scripts/reset-six.ts
//
// ⚠️ DESTRUCTIVE — DO NOT RUN TO ADD A NEW BOT ⚠️
//
// This script deletes EVERY row from paper_positions and resets
// every bots.balance_usd back to the starting balance. Running it
// in the middle of a live experiment destroys all accumulated PnL.
// There is no recovery — Neon free-tier doesn't give point-in-time
// restore.
//
// To add a new bot to the roster while preserving existing state,
// use `scripts/add-bots.ts` instead.
//
// Only run this when the user has explicitly asked to wipe positions
// or "start fresh" in the current session.
//
// ──────────────────────────────────────────────────────────────────
//
// Resets the paper-bot arena to the v4 6-bot test setup:
//
//   • WHALE   — mirrors top Hyperliquid wallet 0xb83de0…6e36
//   • NATIVE  — mirrors top Pacifica wallet 4u3L6r3n…CmZB
//   • SNIPER  — fades cross-CEX funding extremes (>0.5% per 8h)
//   • PULSE   — X (Twitter) trend catcher via Grok 4.3 + x_search
//   • BULLION — XAU long-only max-leverage scalper (80% bankroll)
//   • ATLAS   — SP500 long-only max-leverage scalper (80% bankroll)
//
// Wipes ALL paper_positions, deletes any bot row not in this
// roster, then upserts the 6 with fresh $10,000 balances. Safe to
// rerun (idempotent).

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const STARTING_BALANCE = 10_000;

const TARGET_BOTS = {
  whale: {
    name: "Whale",
    avatarEmoji: "🐋",
    personaVoiceKey: "whale",
    strategyKey: "whale",
    config: {
      sourceKind: "hl-wallet",
      sourceAddress: "0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36",
      maxLeverage: 15,
      maxHoldMs: 24 * 60 * 60 * 1000,
    },
  },
  native: {
    name: "Native",
    avatarEmoji: "🌊",
    personaVoiceKey: "native",
    strategyKey: "native",
    config: {
      sourceKind: "pacifica-wallet",
      sourceAddress: "4u3L6r3nyL9XfZ93gMeXb4eddUGAXAMK8Cqkj1pvCmZB",
      maxLeverage: 12,
      maxHoldMs: 24 * 60 * 60 * 1000,
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
  pulse: {
    name: "Pulse",
    avatarEmoji: "📡",
    personaVoiceKey: "pulse",
    strategyKey: "pulse",
    config: {
      evalCooldownMs: 60 * 60 * 1000,
      maxHoldMs: 2 * 60 * 60 * 1000,
      exitAdverseStopPct: 0.012,
      minLeverage: 3,
      maxLeverage: 8,
    },
  },
  bullion: {
    name: "Bullion",
    avatarEmoji: "🪙",
    personaVoiceKey: "bullion",
    strategyKey: "bullion",
    config: {
      asset: "XAU",
      side: "long",
      maxLeverage: 10,
      stakePctOverride: 0.8,
      tpPricePct: 0.004,
      slPricePct: 0.007,
      maxHoldMs: 60 * 60 * 1000,
      cooldownAfterCloseMs: 5 * 60 * 1000,
      stopLossPct: 0.9,
    },
  },
  atlas: {
    name: "Atlas",
    avatarEmoji: "📈",
    personaVoiceKey: "atlas",
    strategyKey: "atlas",
    config: {
      asset: "SP500",
      side: "long",
      maxLeverage: 10,
      stakePctOverride: 0.8,
      tpPricePct: 0.003,
      slPricePct: 0.005,
      maxHoldMs: 60 * 60 * 1000,
      cooldownAfterCloseMs: 5 * 60 * 1000,
      stopLossPct: 0.9,
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
        `  ✓ ${botId.padEnd(18)} name="${String(row.name).padEnd(10)}" balance=$${row.balance_usd}`,
      );
    }
  }

  const after = (await sql`
    SELECT id, name, balance_usd, status FROM bots ORDER BY id
  `) as Array<{ id: string; name: string; balance_usd: number; status: string }>;
  console.log("\nAFTER:");
  console.table(after);

  console.log(
    `\nTest start: ${new Date().toISOString()} — let the resolver run.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
