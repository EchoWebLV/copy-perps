// lib/bots/strategies/leviathan.ts
//
// Leviathan — a 3-whale bundle bot, same composite-source chassis as
// Whale. Wraps three super-active Pacifica directional whales behind
// one source. One whale dormant or blown up → the other two carry it.
//
// Wallets curated 2026-05-16 from the Pacifica leaderboard: active
// directional traders, turnover-filtered to exclude market-makers,
// verified currently trading BTC/ETH/SOL.

import { createPacificaWalletSource } from "@/lib/sources/pacifica-wallet";
import { createMultiWalletSource } from "@/lib/sources/multi-wallet";
import { buildMirrorBot } from "./source-mirror";

const LEVIATHAN_PACK = createMultiWalletSource({
  id: "leviathan-pack",
  displayName: "Leviathan Pack",
  sources: [
    createPacificaWalletSource({
      address: "5RX2DD425DHj3VAouTbJWHtmBmzi2oUmuErwmfwgxs8n",
      displayName: "Pacifica whale 5RX2D…xs8n",
      defaultLeverage: 10,
    }),
    createPacificaWalletSource({
      address: "F5BcMNcVyxeWqXyEivRc5NuUrFMZgNxnmwVvLpRKLdaf",
      displayName: "Pacifica whale F5BcM…Ldaf",
      defaultLeverage: 10,
    }),
    createPacificaWalletSource({
      address: "DCmDxhZ6Tz8k46th3aEQrMHPGmRXeKrrakBitMm4V9mz",
      displayName: "Pacifica whale DCmDx…V9mz",
      defaultLeverage: 10,
    }),
  ],
});

const built = buildMirrorBot({
  id: "leviathan",
  name: "Leviathan",
  avatarEmoji: "🐉",
  personaVoiceKey: "leviathan",
  source: LEVIATHAN_PACK,
  maxLeverage: 50,
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const LeviathanStrategy = built.strategy;
export const LeviathanBot = built.bot;
