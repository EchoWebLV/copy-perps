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
    fetchOpenPositionsForBot: vi.fn(async () => []),
    getBotBalance: vi.fn(async () => 1000),
    markBotBusted: vi.fn(),
  };
});
vi.mock("./cross-bot", () => ({
  getCrossBotSnapshot: vi.fn(async () => ({
    positionsByAssetSide: new Map<string, number>(),
    botsByAsset: new Map(),
    familyHoldings: new Set<string>(),
  })),
}));

import { tick } from "./resolver";
import { listBots, getStrategy } from "./index";
import {
  openPaperPosition,
  closePaperPosition,
  fetchOpenPositionsForBot,
  getBotBalance,
  markBotBusted,
} from "./paper";
import { getCrossBotSnapshot } from "./cross-bot";

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
    // First call: no open positions (exit phase)
    // Second call: still no positions (entry phase free-balance calc)
    vi.mocked(fetchOpenPositionsForBot).mockResolvedValue([]);
    vi.mocked(getBotBalance).mockResolvedValue(1000);

    await tick();

    expect(openPaperPosition).toHaveBeenCalledTimes(1);
    // 1000 balance × 0.5 MAX_STAKE_PCT × 0.5 conviction = 250
    const callArg = vi.mocked(openPaperPosition).mock.calls[0][0];
    expect(callArg.stakeUsd).toBe(250);
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
      stakeUsd: 100,
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
    // First call (exit phase): one open position
    // Second call (entry-eval phase): empty after close
    vi.mocked(fetchOpenPositionsForBot)
      .mockResolvedValueOnce([openPos])
      .mockResolvedValueOnce([]);
    vi.mocked(getBotBalance).mockResolvedValue(1000);

    await tick();

    expect(closePaperPosition).toHaveBeenCalledTimes(1);
    const closeArg = vi.mocked(closePaperPosition).mock.calls[0][0];
    expect(closeArg.positionId).toBe("pp-1");
    expect(closeArg.botId).toBe("test-bot");
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
    expect(fetchOpenPositionsForBot).not.toHaveBeenCalled();
  });

  it("marks a bot busted when balance drops below $10", async () => {
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
      id: "pp-bust",
      botId: "test-bot",
      asset: "SOL",
      side: "long",
      leverage: 10,
      stakeUsd: 500,
      entryMark: 100,
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
    // Exit phase: one open position that will be closed
    vi.mocked(fetchOpenPositionsForBot).mockResolvedValueOnce([openPos]);
    // After close, balance is $5 (below bust threshold of $10)
    vi.mocked(getBotBalance).mockResolvedValue(5);

    const result = await tick();

    expect(closePaperPosition).toHaveBeenCalledTimes(1);
    expect(markBotBusted).toHaveBeenCalledWith("test-bot");
    expect(result.busted).toBe(1);
  });

  it("skips entry when MAX_BOTS_SAME_SIDE is already reached", async () => {
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
      evaluateEntry: () => ({
        asset: "SOL",
        side: "long",
        leverage: 10,
        conviction: 0.5,
        triggerMeta: {},
      }),
      evaluateExit: () => false,
    };
    vi.mocked(listBots).mockReturnValue([bot]);
    vi.mocked(getStrategy).mockReturnValue(strategy);
    vi.mocked(fetchOpenPositionsForBot).mockResolvedValue([]);
    vi.mocked(getBotBalance).mockResolvedValue(1000);
    vi.mocked(getCrossBotSnapshot).mockResolvedValue({
      positionsByAssetSide: new Map([["SOL|long", 3]]), // already 3 bots long SOL
      botsByAsset: new Map([
        [
          "SOL",
          [
            { botId: "a", side: "long", family: null },
            { botId: "b", side: "long", family: null },
            { botId: "c", side: "long", family: null },
          ],
        ],
      ]),
      familyHoldings: new Set<string>(),
    });

    await tick();

    // Strategy fired, but pileup gate blocked the open.
    expect(openPaperPosition).not.toHaveBeenCalled();
  });
});
