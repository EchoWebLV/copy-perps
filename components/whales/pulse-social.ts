export type PulseReaction = "Tailing" | "Bullish" | "Bearish";

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
