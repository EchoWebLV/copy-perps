import { describe, expect, it } from "vitest";
import type { FlatPosition } from "./live-positions";
import { buildLivePositionContext } from "./live-position-context";

const position = (
  positionId: string,
  asset: string,
  side: "long" | "short",
  livePaperPnlPct: number,
  openSinceMs: number,
): FlatPosition => ({
  positionId,
  asset,
  side,
  leverage: 10,
  entryMark: 100,
  currentMark: 101,
  stakeUsd: 50,
  livePaperPnlUsd: livePaperPnlPct * 50,
  livePaperPnlPct,
  openSinceMs,
  narrationOpen: null,
  bot: {
    botId: positionId,
    botName: positionId,
    avatarEmoji: "B",
    avatarImageUrl: null,
    mood: "DORMANT",
  },
  disagreements: [],
});

describe("buildLivePositionContext", () => {
  it("summarizes same-asset positioning and ranks peer positions by conviction", () => {
    const selected = position("selected", "SOL", "long", 0.04, 1_000);
    const out = buildLivePositionContext(
      [
        selected,
        position("btc", "BTC", "short", 0.9, 9_000),
        position("low", "SOL", "long", 0.01, 2_000),
        position("high-short", "SOL", "short", -0.2, 3_000),
        position("fresh", "SOL", "long", 0.2, 4_000),
      ],
      selected,
      2,
    );

    expect(out.longCount).toBe(3);
    expect(out.shortCount).toBe(1);
    expect(out.bias).toBe("long");
    expect(out.peers.map((peer) => peer.positionId)).toEqual([
      "fresh",
      "high-short",
    ]);
  });
});
