import { describe, expect, it } from "vitest";
import { pickInitialBotId } from "./bot-selection";

const bot = (id: string, openCount: number) => ({
  payload: {
    botId: id,
    currentPositions: Array.from({ length: openCount }, (_, index) => ({
      positionId: `${id}-${index}`,
    })),
  },
});

describe("pickInitialBotId", () => {
  it("chooses the highest-ranked bot with an open position", () => {
    expect(
      pickInitialBotId([bot("atlas", 0), bot("whale", 1), bot("pulse", 2)]),
    ).toBe("whale");
  });

  it("falls back to the top-ranked bot when no bot has an open position", () => {
    expect(pickInitialBotId([bot("atlas", 0), bot("whale", 0)])).toBe(
      "atlas",
    );
  });

  it("returns null for an empty roster", () => {
    expect(pickInitialBotId([])).toBeNull();
  });
});
