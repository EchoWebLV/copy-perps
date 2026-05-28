import { describe, expect, it } from "vitest";
import type { WhaleTailPosition } from "./tail-types";
import {
  whaleTailAutoCloseLabel,
  whaleTailFollowingText,
  whaleTailPositionsHeading,
  whaleTailPrimaryCta,
} from "./tail-copy-labels";

const solLong: WhaleTailPosition = {
  sourcePositionId: "pos-sol",
  asset: "SOL",
  side: "long",
  leverage: 5,
  entryMark: 100,
  currentMark: 101,
  stale: false,
  lastSeenAtMs: Date.parse("2026-05-23T12:00:00.000Z"),
};

describe("tail copy labels", () => {
  it("frames a single whale position as copying this position", () => {
    expect(whaleTailPositionsHeading([solLong])).toBe("Position to copy");
    expect(whaleTailFollowingText({
      sourceName: "Whale One",
      positions: [solLong],
      copyableCount: 1,
    })).toBe("Whale One's SOL LONG position");
    expect(whaleTailAutoCloseLabel([solLong])).toBe(
      "Close my copy when position closes",
    );
    expect(whaleTailPrimaryCta({
      positions: [solLong],
      effectiveStake: 10,
    })).toBe("Copy this position with $10");
  });

  it("keeps whale-bundle wording when copying multiple open positions", () => {
    const positions = [
      solLong,
      { ...solLong, sourcePositionId: "pos-btc", asset: "BTC" },
    ];

    expect(whaleTailPositionsHeading(positions)).toBe("Current open positions");
    expect(whaleTailFollowingText({
      sourceName: "Whale One",
      positions,
      copyableCount: 2,
    })).toBe("Whale One's 2 ready positions");
    expect(whaleTailAutoCloseLabel(positions)).toBe(
      "Close my copies when whale closes",
    );
    expect(whaleTailPrimaryCta({
      positions,
      effectiveStake: 10,
    })).toBe("Tail whale with $10 each");
  });
});
