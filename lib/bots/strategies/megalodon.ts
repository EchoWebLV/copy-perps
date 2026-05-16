// lib/bots/strategies/megalodon.ts
//
// Megalodon — a 3-whale bundle bot, same composite-source chassis as
// Whale. Wraps three super-active Pacifica directional whales behind
// one source. One whale dormant or blown up → the other two carry it.
//
// Wallets curated 2026-05-16 from the Pacifica leaderboard: active
// directional traders, turnover-filtered to exclude market-makers,
// verified currently trading BTC/ETH/SOL.

import { createPacificaWalletSource } from "@/lib/sources/pacifica-wallet";
import { createMultiWalletSource } from "@/lib/sources/multi-wallet";
import { buildMirrorBot } from "./source-mirror";

const MEGALODON_PACK = createMultiWalletSource({
  id: "megalodon-pack",
  displayName: "Megalodon Pack",
  sources: [
    createPacificaWalletSource({
      address: "AuQbtVLAySyKSSUTjTDM5E4YAP51FE4LJamoQKuCTqqp",
      displayName: "Pacifica whale AuQbt…Tqqp",
      defaultLeverage: 10,
    }),
    createPacificaWalletSource({
      address: "8wxZY37A6Qwf3zqWU4gfeoYY9N3Y1UWs7Kmsd8H3h9xm",
      displayName: "Pacifica whale 8wxZY…h9xm",
      defaultLeverage: 10,
    }),
    createPacificaWalletSource({
      address: "EfLVCLeC64YVm4Kt4NusfacvxQoDew4acpReBuCdk2wB",
      displayName: "Pacifica whale EfLVC…k2wB",
      defaultLeverage: 10,
    }),
  ],
});

const built = buildMirrorBot({
  id: "megalodon",
  name: "Megalodon",
  avatarEmoji: "🦈",
  personaVoiceKey: "megalodon",
  source: MEGALODON_PACK,
  maxLeverage: 50,
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const MegalodonStrategy = built.strategy;
export const MegalodonBot = built.bot;
