// lib/bots/strategies/whale.ts
//
// WHALE — a BUNDLE bot. Instead of mirroring one wallet, Whale wraps a
// pack of three super-active whales across Hyperliquid and Pacifica
// behind a single composite source (lib/sources/multi-wallet.ts).
//
// Why a pack: a single-wallet bot goes silent the moment that wallet
// stops trading. With three, the bot degrades gracefully — one whale
// dormant or blown up, the other two carry it; only all three going
// quiet at once silences it. Per asset the heaviest-notional whale
// wins. Curation tax drops too: a stale wallet in a pool of three is
// a swap-whenever, not a dead bot.
//
// To re-curate: swap an address below and redeploy. The mirror logic
// (source-mirror.ts) is unchanged — it can't tell a pool from a wallet.

import { createHlWalletSource } from "@/lib/sources/hl-wallet";
import { createPacificaWalletSource } from "@/lib/sources/pacifica-wallet";
import { createMultiWalletSource } from "@/lib/sources/multi-wallet";
import { buildMirrorBot } from "./source-mirror";

// The pack — all three whales the arena follows, bundled. Two
// Hyperliquid wallets + one Pacifica wallet, all picked for high
// activity (curated 2026-05-15).
const WHALE_PACK = createMultiWalletSource({
  id: "whale-pack",
  displayName: "Whale Pack",
  sources: [
    createHlWalletSource({
      address: "0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36",
      displayName: "HL whale 0xb83de…6e36",
    }),
    createHlWalletSource({
      address: "0x939f95036d2e7b6d7419ec072bf9d967352204d2",
      displayName: "HL whale 0x939f9…04d2",
    }),
    createPacificaWalletSource({
      address: "4u3L6r3nyL9XfZ93gMeXb4eddUGAXAMK8Cqkj1pvCmZB",
      displayName: "Pacifica whale 4u3L6…CmZB",
      defaultLeverage: 10,
    }),
  ],
});

const built = buildMirrorBot({
  id: "whale",
  name: "Whale",
  avatarEmoji: "🐋",
  personaVoiceKey: "whale",
  source: WHALE_PACK,
  // Cap covers the pack's most aggressive member (a ~40x wallet);
  // each position still mirrors that whale's own leverage, clamped
  // to the venue max on the order-build path.
  maxLeverage: 50,
  // 24h hold cap — most whale positions resolve within a day.
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const WhaleStrategy = built.strategy;
export const WhaleBot = built.bot;
