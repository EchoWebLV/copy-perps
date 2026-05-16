// lib/bots/strategies/native.ts
//
// NATIVE — mirrors a top Pacifica leaderboard trader. Same venue
// we route user tails to, so the source's edge is being demonstrated
// against the exact liquidity our tailers will face. The cleanest
// alignment in the roster.

import { createPacificaWalletSource } from "@/lib/sources/pacifica-wallet";
import { buildMirrorBot } from "./source-mirror";

// Address picked 2026-05-15: $52k 30d PnL, $28k 1d PnL (currently
// running hot), $468k equity, $151k 1d volume. Re-curate via
// leaderboard if perf decays.
const NATIVE_ADDRESS = "4u3L6r3nyL9XfZ93gMeXb4eddUGAXAMK8Cqkj1pvCmZB";

const NATIVE_SOURCE = createPacificaWalletSource({
  address: NATIVE_ADDRESS,
  displayName: "Pacifica 4u3L6…CmZB",
  defaultLeverage: 10,
});

const built = buildMirrorBot({
  id: "native",
  name: "Native",
  avatarEmoji: "🌊",
  personaVoiceKey: "native",
  source: NATIVE_SOURCE,
  maxLeverage: 24,
  maxHoldMs: 24 * 60 * 60 * 1000,
});

export const NativeStrategy = built.strategy;
export const NativeBot = built.bot;
