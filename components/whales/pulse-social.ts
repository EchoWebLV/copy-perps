export type PulseReaction = "Tailing" | "Bullish" | "Bearish";

export const PULSE_REACTIONS: PulseReaction[] = [
  "Tailing",
  "Bullish",
  "Bearish",
];

export type PulseReactionTone = "accent" | "green" | "red";

export function getPulseReactionTone(
  reaction: PulseReaction,
): PulseReactionTone {
  if (reaction === "Bullish") return "green";
  if (reaction === "Bearish") return "red";
  return "accent";
}

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
