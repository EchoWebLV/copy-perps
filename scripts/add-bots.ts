// scripts/add-bots.ts
//
// NON-DESTRUCTIVE bot adder. Inserts new bot rows that don't yet
// exist; leaves every existing bot row, balance, and open/closed
// position completely untouched. Use this whenever expanding the
// roster mid-experiment.
//
// To run for a specific bot: `tsx scripts/add-bots.ts <bot-id>`
//   e.g. `tsx scripts/add-bots.ts kraken`
//
// To run for the entire add-set (default): just `tsx scripts/add-bots.ts`
//
// NOTE — if you actually want to wipe positions and start fresh, use
// `reset-six.ts` instead. This script will SKIP any bot id that
// already exists in the DB (no overwrite, no balance reset).

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const STARTING_BALANCE = 10_000;

// Add-set. Edit this when you want to ship a new bot without touching
// the existing experiment. Each entry follows the same shape as the
// reset script's TARGET_BOTS map.
const ADD_BOTS: Record<
  string,
  {
    name: string;
    avatarEmoji: string;
    personaVoiceKey: string;
    strategyKey: string;
    config: Record<string, unknown>;
  }
> = {
  // 2026-05-16 — three new 3-whale bundle bots, each wrapping three
  // super-active Pacifica directional whales (see strategies/*.ts).
  orca: {
    name: "Orca",
    avatarEmoji: "🐳",
    personaVoiceKey: "orca",
    strategyKey: "orca",
    config: {
      sourceKind: "multi-wallet",
      maxLeverage: 50,
      maxHoldMs: 24 * 60 * 60 * 1000,
    },
  },
  leviathan: {
    name: "Leviathan",
    avatarEmoji: "🐉",
    personaVoiceKey: "leviathan",
    strategyKey: "leviathan",
    config: {
      sourceKind: "multi-wallet",
      maxLeverage: 50,
      maxHoldMs: 24 * 60 * 60 * 1000,
    },
  },
  megalodon: {
    name: "Megalodon",
    avatarEmoji: "🦈",
    personaVoiceKey: "megalodon",
    strategyKey: "megalodon",
    config: {
      sourceKind: "multi-wallet",
      maxLeverage: 50,
      maxHoldMs: 24 * 60 * 60 * 1000,
    },
  },
  // 2026-05-17 — Blitz: medium-speed 15m crypto momentum/breakout bot.
  blitz: {
    name: "Blitz",
    avatarEmoji: "🚀",
    personaVoiceKey: "blitz",
    strategyKey: "blitz",
    config: {
      timeframe: "15m",
      candleCount: 12,
      breakoutPct: 0.006,
      volumeMultiplier: 1.4,
      exitFavorablePct: 0.01,
      maxHoldMs: 90 * 60 * 1000,
      leverage: 20,
      minLeverage: 10,
      maxLeverage: 30,
      regimesAllowed: ["trending-up", "trending-down", "vol-expanding"],
    },
  },
  // 2026-05-17 — Tilt: degenerate revenge trader (momentum + martingale).
  tilt: {
    name: "Tilt",
    avatarEmoji: "🎰",
    personaVoiceKey: "tilt",
    strategyKey: "tilt",
    config: {
      stakePctOverride: 0.6,
      stopLossPct: 0.9,
    },
  },
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const argFilter = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const target =
    argFilter.length > 0
      ? Object.fromEntries(
          Object.entries(ADD_BOTS).filter(([k]) => argFilter.includes(k)),
        )
      : ADD_BOTS;
  if (Object.keys(target).length === 0) {
    console.error(
      `No bots matched. Known add-set: ${Object.keys(ADD_BOTS).join(", ")}`,
    );
    process.exit(1);
  }

  const before = (await sql`SELECT COUNT(*) AS n FROM bots`) as Array<{
    n: number;
  }>;
  console.log(`Existing bots in DB: ${before[0].n} (will be left untouched)`);

  for (const [botId, spec] of Object.entries(target)) {
    const existing = await sql`SELECT id FROM bots WHERE id = ${botId} LIMIT 1`;
    if (existing.length > 0) {
      console.log(`  • ${botId.padEnd(18)} already exists — SKIPPED`);
      continue;
    }
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
      RETURNING id, name, balance_usd
    `;
    console.log(
      `  ✓ ${botId.padEnd(18)} INSERTED  name="${result[0].name}"  balance=$${result[0].balance_usd}`,
    );
  }

  const after = (await sql`
    SELECT id, name, balance_usd, status FROM bots ORDER BY id
  `) as Array<{ id: string; name: string; balance_usd: number; status: string }>;
  console.log("\nCurrent roster:");
  console.table(after);
  console.log(
    "\nNote: this script never touches paper_positions. Existing PnL, open positions, and bot histories are preserved.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
