// lib/bots/strategies/orca.ts
//
// Orca — a 3-whale bundle bot, same composite-source chassis as Whale.
// Wraps three super-active Pacifica directional whales behind one
// source. One whale dormant or blown up → the other two carry it.
//
// Wallets curated 2026-05-16 from the Pacifica leaderboard: active
// directional traders, turnover-filtered to exclude market-makers,
// verified currently trading BTC/ETH/SOL.

import { createPacificaWalletSource } from "@/lib/sources/pacifica-wallet";
import { createMultiWalletSource } from "@/lib/sources/multi-wallet";
import { buildMirrorBot } from "./source-mirror";

const ORCA_PACK = createMultiWalletSource({
  id: "orca-pack",
  displayName: "Orca Pack",
  sources: [
    createPacificaWalletSource({
      address: "HQWz5Pje7tbqJVTy7ES41P4moxQWHXhCqMYGnsQirzq9",
      displayName: "Pacifica whale HQWz5…rzq9",
      defaultLeverage: 10,
    }),
    createPacificaWalletSource({
      address: "GTU92nBC8LMyt9W4Qqc319BFR1vpkNNPAbt4QCnX7kZ6",
      displayName: "Pacifica whale GTU92…7kZ6",
      defaultLeverage: 10,
    }),
    createPacificaWalletSource({
      address: "qeuSxqpV8JdGMSdZPWB7WGof6bhXbC6FCiAscb6hCFd",
      displayName: "Pacifica whale qeuSx…hCFd",
      defaultLeverage: 10,
    }),
  ],
});

const built = buildMirrorBot({
  id: "orca",
  name: "Orca",
  avatarEmoji: "🐳",
  personaVoiceKey: "orca",
  source: ORCA_PACK,
  maxLeverage: 50,
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const OrcaStrategy = built.strategy;
export const OrcaBot = built.bot;
