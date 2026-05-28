import { describe, expect, it } from "vitest";
import {
  copyableWhalePositionsForTail,
  whaleTailTotalNotional,
} from "./whale-tail";
import type { TailSource } from "./tail-types";

describe("whale tail helpers", () => {
  it("copies only fresh whale positions and totals stake per position", () => {
    const now = Date.parse("2026-05-23T12:00:00.000Z");
    const source: Extract<TailSource, { kind: "whale" }> = {
      kind: "whale",
      whaleId: "whale-1",
      displayName: "Alpha Whale",
      avatarUrl: null,
      sourceAccount: "acct-1",
      sourcePositionId: "primary",
      asset: "SOL",
      side: "long",
      leverage: 5,
      entryMark: 100,
      currentMark: 101,
      stale: false,
      lastSeenAtMs: now - 30_000,
      positions: [
        {
          sourcePositionId: "primary",
          asset: "SOL",
          side: "long",
          leverage: 5,
          entryMark: 100,
          currentMark: 101,
          stale: false,
          lastSeenAtMs: now - 30_000,
        },
        {
          sourcePositionId: "closed-soon",
          asset: "ETH",
          side: "short",
          leverage: 3,
          entryMark: 3000,
          currentMark: 2990,
          stale: true,
          lastSeenAtMs: now - 30_000,
        },
        {
          sourcePositionId: "second",
          asset: "BTC",
          side: "long",
          leverage: 2,
          entryMark: 70000,
          currentMark: 70500,
          stale: false,
          lastSeenAtMs: now - 45_000,
        },
        {
          sourcePositionId: "hyper-only",
          asset: "HYPE",
          side: "long",
          leverage: 2,
          entryMark: 20,
          currentMark: 21,
          stale: false,
          lastSeenAtMs: now - 30_000,
          copyableOnPacifica: false,
        },
        {
          sourcePositionId: "aged-out",
          asset: "XAU",
          side: "long",
          leverage: 2,
          entryMark: 2400,
          currentMark: 2410,
          stale: false,
          lastSeenAtMs: now - 4 * 60_000,
        },
      ],
    };

    const copyable = copyableWhalePositionsForTail(source, now);

    expect(copyable.map((p) => p.sourcePositionId)).toEqual([
      "primary",
      "second",
    ]);
    expect(whaleTailTotalNotional(10, copyable)).toBe(70);
  });
});
