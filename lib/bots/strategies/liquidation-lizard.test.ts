// lib/bots/strategies/liquidation-lizard.test.ts
import { describe, it, expect } from "vitest";
import { LiquidationLizardStrategy } from "./liquidation-lizard";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const baseCtx: MarketContext = { asset: "SOL", mark: 100 };
const emptySignals: ExternalSignals = { liquidations: [], funding: {} };

describe("LiquidationLizard.evaluateEntry", () => {
  it("returns null when no liquidations", () => {
    expect(LiquidationLizardStrategy.evaluateEntry(baseCtx, emptySignals)).toBeNull();
  });

  it("opens a long when a long was just liquidated above threshold", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "SOL",
          side: "long",
          notionalUsd: 75_000,
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).not.toBeNull();
    expect(decision!.asset).toBe("SOL");
    expect(decision!.side).toBe("long");
  });

  it("ignores liquidations below the $50k threshold", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "SOL",
          side: "long",
          notionalUsd: 30_000,
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).toBeNull();
  });

  it("ignores liquidations for other assets", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "BTC",
          side: "long",
          notionalUsd: 100_000,
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).toBeNull();
  });

  it("ignores stale liquidations (>60s old)", () => {
    const decision = LiquidationLizardStrategy.evaluateEntry(baseCtx, {
      liquidations: [
        {
          asset: "SOL",
          side: "long",
          notionalUsd: 100_000,
          ts: Date.now() - 120_000,
          source: "hyperliquid",
        },
      ],
      funding: {},
    });
    expect(decision).toBeNull();
  });
});

describe("LiquidationLizard.evaluateExit", () => {
  const openPos: PaperPosition = {
    id: "p1",
    botId: "liquidation-lizard",
    asset: "SOL",
    side: "long",
    leverage: 50,
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

  it("exits when price moves +0.5% favorable on a long", () => {
    expect(
      LiquidationLizardStrategy.evaluateExit(
        { asset: "SOL", mark: 100.6 },
        openPos,
      ),
    ).toBe(true);
  });

  it("does not exit on a small favorable move", () => {
    expect(
      LiquidationLizardStrategy.evaluateExit(
        { asset: "SOL", mark: 100.2 },
        openPos,
      ),
    ).toBe(false);
  });

  it("exits after 90s timeout", () => {
    const oldPos: PaperPosition = {
      ...openPos,
      entryTs: new Date(Date.now() - 100_000),
    };
    expect(
      LiquidationLizardStrategy.evaluateExit(
        { asset: "SOL", mark: 100 },
        oldPos,
      ),
    ).toBe(true);
  });
});
