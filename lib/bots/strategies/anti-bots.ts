// lib/bots/strategies/anti-bots.ts
//
// Anti-Surge and Anti-Fade — mirror bots for the inversion test. Each
// uses its base strategy's full trigger logic (same asset universe,
// same thresholds, same dynamic leverage) but flips the side on entry.
//
// Math: if the base bot has a gross edge of E per trade and round-trip
// friction is F, the base nets (E - F) and the mirror nets (-E - F).
// The mirror is profitable only if |E| > F. So if a base bot is losing
// meaningful money (gross negative edge well past friction floor), the
// mirror should win — and vice versa.

import type { BotConfig } from "../types";
import { createInverseStrategy } from "./inverse";
import { MomoMaxAggressiveStrategy } from "./momo-max";
import { MeanRevertMikeStrategy } from "./mean-revert-mike";

export const AntiSurgeStrategy = createInverseStrategy(
  MomoMaxAggressiveStrategy,
  { id: "anti-surge" },
);

export const AntiFadeStrategy = createInverseStrategy(
  MeanRevertMikeStrategy,
  { id: "anti-fade" },
);

export const AntiSurgeBot: BotConfig = {
  id: "anti-surge",
  parentId: null,
  name: "Anti-Surge",
  avatarEmoji: "🪞",
  personaVoiceKey: "anti-surge",
  strategyKey: "anti-surge",
  config: {
    inverseOf: "momo-max-aggressive",
  },
  status: "paper",
};

export const AntiFadeBot: BotConfig = {
  id: "anti-fade",
  parentId: null,
  name: "Anti-Fade",
  avatarEmoji: "🪞",
  personaVoiceKey: "anti-fade",
  strategyKey: "anti-fade",
  config: {
    inverseOf: "mean-revert-mike",
  },
  status: "paper",
};
