// lib/bots/strategies/whale.ts
//
// WHALE — mirrors a specific top-tier Hyperliquid trader's positions.
// Chosen from the leaderboard for: positive 30d PnL, big account
// (currently $10M+), moderate cadence (~30 opens/day, not HFT), trades
// in BTC/ETH/SOL plus alts (we filter to BTC/ETH/SOL only).
//
// To re-curate when this wallet decays: update WHALE_ADDRESS, redeploy.
// The mirror logic doesn't care which wallet it points at.

import { createHlWalletSource } from "@/lib/sources/hl-wallet";
import { buildMirrorBot } from "./source-mirror";

// Address picked 2026-05-15: $10.3M account value, currently up
// $186k on ETH/SOL shorts, 32 opens/24h, holds 12 simultaneous
// positions. Replace via reset script if performance decays.
const WHALE_ADDRESS = "0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36";

const WHALE_SOURCE = createHlWalletSource({
  address: WHALE_ADDRESS,
  displayName: "Whale 0xb83de…6e36",
});

const built = buildMirrorBot({
  id: "whale",
  name: "Whale",
  avatarEmoji: "🐋",
  personaVoiceKey: "whale",
  source: WHALE_SOURCE,
  maxLeverage: 15,
  // 24h hold cap — most HL whale positions resolve within a day.
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const WhaleStrategy = built.strategy;
export const WhaleBot = built.bot;
