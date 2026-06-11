import { describe, expect, it } from "vitest";
import type {
  ArenaBot,
  ArenaBucket,
  ArenaMarketState,
  ArenaPosition,
} from "@/lib/arena/decode";
import { STALE_AFTER_MS } from "@/lib/arena/use-arena-live";
import { botCopyCta, buildBotTailSource } from "./bot-tail-source";

function makePosition(overrides: Partial<ArenaPosition> = {}): ArenaPosition {
  return {
    active: true,
    marketId: 0,
    side: "long",
    entryPrice: 142.5,
    stakeUsd: 50,
    leverage: 100,
    openedTsMs: 1_000,
    ticksHeld: 3,
    liqPrice: 141.1,
    ...overrides,
  };
}

function makeBot(overrides: Partial<ArenaBot> = {}): ArenaBot {
  return {
    balanceUsd: 950,
    grossPnlUsd: -50,
    feesUsd: 4,
    equityHighUsd: 1_020,
    seq: 12,
    positions: [makePosition()],
    tape: [],
    params: {
      maxHoldTicks: 20,
      breakoutBps: 30,
      activityMultBps: 10_000,
      stakeFracBps: 500,
      leverage: 100,
      exitFavorableBps: 25,
      readSpan: 4,
      trendFilter: false,
    },
    personaName: "scalper-v1",
    trades: 0,
    wins: 0,
    tapeHead: 0,
    bump: 255,
    ...overrides,
  };
}

const BUCKET: ArenaBucket = {
  open: 142,
  high: 143,
  low: 141.5,
  close: 142.8,
  startTsMs: 1_000,
  pathLen: 2,
  updates: 4,
};

function makeMarket(
  overrides: Partial<ArenaMarketState> = {},
): ArenaMarketState {
  return {
    lastPrice: 142.8,
    lastPublishTsMs: 60_000,
    head: 0,
    marketId: 0,
    bump: 254,
    ring: [BUCKET],
    headBucket: BUCKET,
    ...overrides,
  };
}

describe("buildBotTailSource", () => {
  it("returns null for an unloaded bot", () => {
    expect(buildBotTailSource("scalper-v1", null, makeMarket())).toBeNull();
  });

  it("returns null when the bot has no active position", () => {
    const flat = makeBot({ positions: [] });
    expect(buildBotTailSource("scalper-v1", flat, makeMarket())).toBeNull();

    const allInactive = makeBot({
      positions: [makePosition({ active: false })],
    });
    expect(
      buildBotTailSource("scalper-v1", allInactive, makeMarket()),
    ).toBeNull();
  });

  it("returns null when the market account is missing (no live mark)", () => {
    expect(buildBotTailSource("scalper-v1", makeBot(), null)).toBeNull();
  });

  it("returns null when the market is for a different marketId", () => {
    expect(
      buildBotTailSource("scalper-v1", makeBot(), makeMarket({ marketId: 1 })),
    ).toBeNull();
  });

  it("fails closed on garbage entry price or leverage", () => {
    const zeroEntry = makeBot({
      positions: [makePosition({ entryPrice: 0 })],
    });
    expect(buildBotTailSource("scalper-v1", zeroEntry, makeMarket())).toBeNull();

    const zeroLeverage = makeBot({
      positions: [makePosition({ leverage: 0 })],
    });
    expect(
      buildBotTailSource("scalper-v1", zeroLeverage, makeMarket()),
    ).toBeNull();
  });

  it("maps every field, namespacing botId and positionId under arena:", () => {
    const bot = makeBot({
      positions: [
        makePosition({
          side: "short",
          leverage: 100,
          entryPrice: 142.5,
          openedTsMs: 1_718_000_000_000,
        }),
      ],
    });

    expect(buildBotTailSource("scalper-v1", bot, makeMarket())).toEqual({
      kind: "bot",
      botId: "arena:scalper-v1",
      botName: "Scalper",
      avatarEmoji: "⚡",
      avatarImageUrl: null,
      asset: "SOL",
      side: "short",
      leverage: 100,
      maxLeverage: null,
      entryMark: 142.5,
      positionId: "arena:scalper-v1:1718000000000",
    });
  });

  it("never emits the bare persona name as botId (legacy paper-bot ids were bare)", () => {
    const source = buildBotTailSource("rider-v1", makeBot(), makeMarket());
    expect(source?.botId).toBe("arena:rider-v1");
    expect(source?.botId).not.toBe("rider-v1");
  });

  it("falls back to the raw name + robot emoji for unknown personas, and the MKT ticker for unknown markets", () => {
    const bot = makeBot({
      positions: [makePosition({ marketId: 7 })],
    });
    const source = buildBotTailSource(
      "mystery-v9",
      bot,
      makeMarket({ marketId: 7 }),
    );
    expect(source?.botName).toBe("mystery-v9");
    expect(source?.avatarEmoji).toBe("🤖");
    expect(source?.asset).toBe("MKT7");
  });

  it("tails the primary (freshest active) position when several are open", () => {
    const bot = makeBot({
      positions: [
        makePosition({ openedTsMs: 1_000, side: "long" }),
        makePosition({ openedTsMs: 9_000, side: "short", entryPrice: 150 }),
        makePosition({ openedTsMs: 99_000, active: false, entryPrice: 7 }),
      ],
    });
    const source = buildBotTailSource("scalper-v1", bot, makeMarket());
    expect(source?.side).toBe("short");
    expect(source?.entryMark).toBe(150);
    expect(source?.positionId).toBe("arena:scalper-v1:9000");
  });
});

describe("botCopyCta", () => {
  const NOW = 1_000_000;
  const fresh = {
    lastUpdateMs: NOW - 1_000,
    nowMs: NOW,
  };

  it("renders no CTA for unloaded or flat bots (the flat line stays)", () => {
    expect(
      botCopyCta({
        name: "scalper-v1",
        bot: null,
        market: makeMarket({ lastPublishTsMs: NOW }),
        ...fresh,
      }),
    ).toEqual({ state: "none" });
    expect(
      botCopyCta({
        name: "scalper-v1",
        bot: makeBot({ positions: [] }),
        market: makeMarket({ lastPublishTsMs: NOW }),
        ...fresh,
      }),
    ).toEqual({ state: "none" });
  });

  it("degrades to stale when no chain read landed recently (transport)", () => {
    const cta = botCopyCta({
      name: "scalper-v1",
      bot: makeBot(),
      market: makeMarket({ lastPublishTsMs: NOW }),
      lastUpdateMs: NOW - STALE_AFTER_MS - 1,
      nowMs: NOW,
    });
    expect(cta).toEqual({ state: "stale" });
  });

  it("degrades to stale when the oracle stopped publishing even though polls keep landing (pause incident)", () => {
    // refetch() restamps lastUpdateMs on every successful read, frozen or
    // not — only lastPublishTsMs exposes a paused crank.
    const cta = botCopyCta({
      name: "scalper-v1",
      bot: makeBot(),
      market: makeMarket({ lastPublishTsMs: NOW - STALE_AFTER_MS - 1 }),
      ...fresh,
    });
    expect(cta).toEqual({ state: "stale" });
  });

  it("is still fresh at exactly the stale boundary (isStale is strict)", () => {
    const cta = botCopyCta({
      name: "scalper-v1",
      bot: makeBot(),
      market: makeMarket({ lastPublishTsMs: NOW - STALE_AFTER_MS }),
      lastUpdateMs: NOW - STALE_AFTER_MS,
      nowMs: NOW,
    });
    expect(cta.state).toBe("tail");
  });

  it("is unavailable when fresh but there is no market account to mark against", () => {
    const cta = botCopyCta({
      name: "scalper-v1",
      bot: makeBot(),
      market: null,
      ...fresh,
    });
    expect(cta).toEqual({ state: "unavailable" });
  });

  it("returns the live tail source when everything is fresh", () => {
    const cta = botCopyCta({
      name: "scalper-v1",
      bot: makeBot(),
      market: makeMarket({ lastPublishTsMs: NOW - 1_000 }),
      ...fresh,
    });
    expect(cta.state).toBe("tail");
    if (cta.state === "tail") {
      expect(cta.source.botId).toBe("arena:scalper-v1");
      expect(cta.source.asset).toBe("SOL");
    }
  });

  it("treats the nowMs=0 first paint as fresh (useNowTick hydration convention)", () => {
    const cta = botCopyCta({
      name: "scalper-v1",
      bot: makeBot(),
      market: makeMarket({ lastPublishTsMs: 60_000 }),
      lastUpdateMs: 50_000,
      nowMs: 0,
    });
    expect(cta.state).toBe("tail");
  });
});
