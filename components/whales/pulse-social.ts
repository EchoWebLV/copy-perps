import type { PulseItem } from "./pulse-items";

export type PulseReaction = "Tailing" | "Bullish" | "Bearish";
export type PulseSocialMetric = PulseReaction | "Comments";

export const PULSE_REACTIONS: PulseReaction[] = [
  "Tailing",
  "Bullish",
  "Bearish",
];

export interface PulseComment {
  id: string;
  author: string;
  profile?: PulseCommentProfile;
  body: string;
  age: string;
}

export interface PulseCommentProfile {
  displayName: string;
  handle: string;
  avatarSeed: string;
}

export function buildPulseSocialStats(
  item: Pick<PulseItem, "reactionSeed" | "canTail" | "kind" | "position">,
): Record<PulseSocialMetric, number> {
  const seed = item.reactionSeed;
  const pnl = item.position.unrealizedPnlPct ?? 0;
  const tailingBase = item.canTail ? 8 : 1;
  const bullishBias = pnl > 0 ? 10 : 2;
  const bearishBias = pnl < 0 ? 10 : item.kind === "entry_gap" ? 8 : 3;

  return {
    Tailing: tailingBase + (seed % 31),
    Bullish: bullishBias + ((seed >>> 4) % 34),
    Bearish: bearishBias + ((seed >>> 9) % 27),
    Comments: 3 + ((seed >>> 14) % 18),
  };
}

export function buildPulseSeedComments(item: PulseItem): PulseComment[] {
  const p = item.position;
  const side = p.side === "long" ? "long" : "short";
  const first =
    item.kind === "pain_trade"
      ? `${p.market} ${side} is bleeding, but the whale is still in it.`
      : item.kind === "entry_gap"
        ? `${p.market} entry gap is the whole trade here. Tail only if the setup still makes sense.`
        : `${p.market} ${side} has momentum, but tailing now is not the same fill.`;
  const second =
    p.copyableOnPacifica === false
      ? "Watching this one only since it cannot route cleanly through Pacifica."
      : `I would size smaller if I tail this ${p.leverage}x position.`;

  return [
    {
      id: `${item.id}:seed-1`,
      author: "TapeReader",
      body: first,
      age: "2m",
    },
    {
      id: `${item.id}:seed-2`,
      author: "RiskDesk",
      body: second,
      age: "5m",
    },
  ];
}
