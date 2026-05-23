import { describe, expect, it } from "vitest";
import {
  copyableWhalePositionsForTail,
  whaleTailTotalNotional,
} from "./whale-tail";
import type { TailSource } from "./tail-types";

describe("whale tail helpers", () => {
  it("copies only fresh whale positions and totals stake per position", () => {
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
      positions: [
        {
          sourcePositionId: "primary",
          asset: "SOL",
          side: "long",
          leverage: 5,
          entryMark: 100,
          currentMark: 101,
          stale: false,
        },
        {
          sourcePositionId: "closed-soon",
          asset: "ETH",
          side: "short",
          leverage: 3,
          entryMark: 3000,
          currentMark: 2990,
          stale: true,
        },
        {
          sourcePositionId: "second",
          asset: "BTC",
          side: "long",
          leverage: 2,
          entryMark: 70000,
          currentMark: 70500,
          stale: false,
        },
        {
          sourcePositionId: "hyper-only",
          asset: "HYPE",
          side: "long",
          leverage: 2,
          entryMark: 20,
          currentMark: 21,
          stale: false,
          copyableOnPacifica: false,
        },
      ],
    };

    const copyable = copyableWhalePositionsForTail(source);

    expect(copyable.map((p) => p.sourcePositionId)).toEqual([
      "primary",
      "second",
    ]);
    expect(whaleTailTotalNotional(10, copyable)).toBe(70);
  });
});
