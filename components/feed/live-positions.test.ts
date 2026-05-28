import { describe, expect, it } from "vitest";
import type { BotSignal } from "@/lib/types";
import { flattenBotPositions } from "./live-positions";

const bot = (botId: string, openSinceMs: number, asset = "SOL") => ({
  payload: {
    botId,
    botName: botId,
    avatarEmoji: "B",
    avatarImageUrl: null,
    mood: "DORMANT",
    currentPositions: [
      {
        positionId: `${botId}-pos`,
        asset,
        side: "long",
        leverage: 10,
        entryMark: 100,
        currentMark: 101,
        stakeUsd: 10,
        livePaperPnlUsd: 1,
        livePaperPnlPct: 0.1,
        openSinceMs,
        narrationOpen: "test",
        disagreements: [],
      },
    ],
  },
});

describe("flattenBotPositions", () => {
  it("sorts freshest positions first", () => {
    const out = flattenBotPositions(
      [bot("old", 1000), bot("new", 2000)] as unknown as BotSignal[],
      null,
    );
    expect(out.map((position) => position.bot.botId)).toEqual(["new", "old"]);
  });

  it("filters by bot id", () => {
    const out = flattenBotPositions(
      [bot("old", 1000), bot("new", 2000)] as unknown as BotSignal[],
      "old",
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.bot.botId).toBe("old");
  });

  it("hides bot positions that cannot be copied through Flash", () => {
    const out = flattenBotPositions(
      [
        bot("supported", 1000, "SOL"),
        bot("unsupported", 2000, "NEAR"),
      ] as unknown as BotSignal[],
      null,
    );
    expect(out.map((position) => position.asset)).toEqual(["SOL"]);
  });
});
