import type { WhaleSide, WhaleSource } from "./types";

export const WHALE_SOURCE_MAX_AGE_MS = 60_000;

export function makeWhaleId(source: WhaleSource, sourceAccount: string): string {
  return `${source}:${sourceAccount}`;
}

export function makeWhalePositionId(args: {
  source: WhaleSource;
  sourceAccount: string;
  market: string;
  side: WhaleSide;
  openedAtMs: number;
}): string {
  return [
    args.source,
    args.sourceAccount,
    args.market.toUpperCase(),
    args.side,
    Math.floor(args.openedAtMs),
  ].join(":");
}

export function generatedWhaleHandle(
  sourceAccount: string | null | undefined,
): string {
  if (!sourceAccount) return "whale_anon";
  return `whale_${sourceAccount.slice(0, 4)}`;
}

export function isSourceFresh(
  lastSeenAtMs: number,
  maxAgeMs = WHALE_SOURCE_MAX_AGE_MS,
  nowMs = Date.now(),
): boolean {
  return nowMs - lastSeenAtMs <= maxAgeMs;
}
