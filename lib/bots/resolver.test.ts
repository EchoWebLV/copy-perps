// lib/bots/resolver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  BotConfig,
  EntryDecision,
  PaperPosition,
  Strategy,
} from "./types";

// We stub out the registry + DB to test resolver logic in isolation.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("./index", () => ({
  listBots: vi.fn(),
  getStrategy: vi.fn(),
}));
vi.mock("@/lib/data/marks", () => ({
  getMarksSnapshot: vi.fn(async () => new Map([["SOL", 100]])),
}));
vi.mock("@/lib/hyperliquid/client", () => ({
  getRecentLiquidations: vi.fn(async () => []),
}));
vi.mock("@/lib/data/cex-funding", () => ({
  getFundingRates: vi.fn(async () => ({})),
}));
vi.mock("./paper", async () => {
  const actual = await vi.importActual<typeof import("./paper")>("./paper");
  return {
    ...actual,
    openPaperPosition: vi.fn(),
    closePaperPosition: vi.fn(),
    fetchOpenPositions: vi.fn(async () => []),
  };
});

import { tick } from "./resolver";
import { listBots, getStrategy } from "./index";
import { openPaperPosition, closePaperPosition, fetchOpenPositions } from "./paper";

describe("resolver.tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a paper position when a strategy fires for an idle bot", async () => {
    const bot: BotConfig = {
      id: "test-bot",
      parentId: null,
      name: "Test",
      avatarEmoji: "🧪",
      personaVoiceKey: "test",
      strategyKey: "test",
      config: {},
      status: "paper",
    };
    const strategy: Strategy = {
      id: "test",
      markets: ["SOL"],
      evaluateEntry: () =>
        ({
          asset: "SOL",
          side: "long",
          leverage: 10,
          conviction: 0.5,
          triggerMeta: { reason: "test" },
        }) satisfies EntryDecision,
      evaluateExit: () => false,
    };
    vi.mocked(listBots).mockReturnValue([bot]);
    vi.mocked(getStrategy).mockReturnValue(strategy);
    vi.mocked(fetchOpenPositions).mockResolvedValue([]);

    await tick();

    expect(openPaperPosition).toHaveBeenCalledTimes(1);
    expect(closePaperPosition).not.toHaveBeenCalled();
  });

  it("closes an open paper position when the strategy says exit", async () => {
    const bot: BotConfig = {
      id: "test-bot",
      parentId: null,
      name: "Test",
      avatarEmoji: "🧪",
      personaVoiceKey: "test",
      strategyKey: "test",
      config: {},
      status: "paper",
    };
    const strategy: Strategy = {
      id: "test",
      markets: ["SOL"],
      evaluateEntry: () => null,
      evaluateExit: () => true,
    };
    const openPos: PaperPosition = {
      id: "pp-1",
      botId: "test-bot",
      asset: "SOL",
      side: "long",
      leverage: 10,
      entryMark: 90,
      entryTs: new Date(),
      exitMark: null,
      exitTs: null,
      paperPnlUsd: null,
      triggerMeta: null,
      narrationOpen: null,
      narrationClose: null,
      status: "open",
    };
    vi.mocked(listBots).mockReturnValue([bot]);
    vi.mocked(getStrategy).mockReturnValue(strategy);
    vi.mocked(fetchOpenPositions).mockResolvedValue([openPos]);

    await tick();

    expect(closePaperPosition).toHaveBeenCalledTimes(1);
    expect(openPaperPosition).not.toHaveBeenCalled();
  });

  it("skips bots with status != 'paper'", async () => {
    const bot: BotConfig = {
      id: "retired",
      parentId: null,
      name: "Retired",
      avatarEmoji: "💤",
      personaVoiceKey: "test",
      strategyKey: "test",
      config: {},
      status: "retired",
    };
    vi.mocked(listBots).mockReturnValue([bot]);

    await tick();

    expect(openPaperPosition).not.toHaveBeenCalled();
    expect(closePaperPosition).not.toHaveBeenCalled();
  });
});
