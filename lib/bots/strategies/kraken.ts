// lib/bots/strategies/kraken.ts
//
// Kraken — high-leverage Hyperliquid whale mirror. Pegged to a
// different wallet than Whale: this one runs single-asset 40x
// positions, currently up +485% ROE on an $30M BTC long. The "max-
// leverage degen" archetype.
//
// Reuses the source-mirror chassis with a higher maxLeverage cap so
// the bot can match the source's actual size. Pacifica's per-market
// max-leverage clamp still applies via clampLeverageForNotional on
// the order-build path, so if the source is at 40x but Pacifica caps
// the market at 20x, we'll run at 20x.

import { createHlWalletSource } from "@/lib/sources/hl-wallet";
import { buildMirrorBot } from "./source-mirror";

// Picked 2026-05-15: $12.1M account, single BTC long at 40x, +485% ROE.
// The most aggressive directional bet on the leaderboard at the time.
const KRAKEN_ADDRESS = "0x939f95036d2e7b6d7419ec072bf9d967352204d2";

const KRAKEN_SOURCE = createHlWalletSource({
  address: KRAKEN_ADDRESS,
  displayName: "Kraken 0x939f9…04d2",
});

const built = buildMirrorBot({
  id: "kraken",
  name: "Kraken",
  avatarEmoji: "🦑",
  personaVoiceKey: "kraken",
  source: KRAKEN_SOURCE,
  maxLeverage: 40,
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const KrakenStrategy = built.strategy;
export const KrakenBot = built.bot;
