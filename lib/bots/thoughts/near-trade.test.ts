import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));

import { detectNearTradeCandidates } from "./near-trade";
import type { ExternalSignals } from "../types";

describe("detectNearTradeCandidates — funding strategies", () => {
  it("returns a candidate when funding is 70-99% of threshold", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.000075, // 0.75 bps
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    const out = detectNearTradeCandidates({ bots, signals });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      botId: "funding-phoebe",
      kind: "near_trade",
    });
    expect(out[0].meta).toMatchObject({
      signalKind: "funding",
      asset: "AVAX",
    });
  });

  it("rejects when funding is below 70% of threshold", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.00005, // 0.5 bps, 50% of 1bp threshold
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });

  it("rejects when funding has already crossed threshold (would have fired)", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.0002, // 2 bps, above 1bp threshold
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });
});

describe("detectNearTradeCandidates — liquidation strategies", () => {
  it("returns a candidate when a recent liquidation is 70-99% of minNotional", () => {
    const signals: ExternalSignals = {
      liquidations: [
        {
          asset: "BTC",
          side: "long",
          notionalUsd: 40_000, // 80% of $50K
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    };
    const bots = [
      {
        id: "liquidation-lizard",
        strategyKey: "liquidation-lizard",
        config: { minLiqNotionalUsd: 50_000 },
      },
    ];
    const out = detectNearTradeCandidates({ bots, signals });
    expect(out).toHaveLength(1);
    expect(out[0].meta.signalKind).toBe("liquidation");
  });

  it("rejects liquidations on assets outside the lizard's allowed markets", () => {
    const signals: ExternalSignals = {
      liquidations: [
        {
          asset: "AVAX", // not in BTC/ETH/SOL
          side: "long",
          notionalUsd: 40_000, // in 70-99% band
          ts: Date.now(),
          source: "hyperliquid",
        },
      ],
      funding: {},
    };
    const bots = [
      {
        id: "liquidation-lizard",
        strategyKey: "liquidation-lizard",
        config: { minLiqNotionalUsd: 50_000 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });

  it("rejects liquidations older than the staleness window", () => {
    const signals: ExternalSignals = {
      liquidations: [
        {
          asset: "BTC",
          side: "long",
          notionalUsd: 40_000,
          ts: Date.now() - 90_000, // 90s old, past the 60s fresh window
          source: "hyperliquid",
        },
      ],
      funding: {},
    };
    const bots = [
      {
        id: "liquidation-lizard",
        strategyKey: "liquidation-lizard",
        config: { minLiqNotionalUsd: 50_000 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });
});

describe("detectNearTradeCandidates — limit + filtering", () => {
  it("emits at most one candidate per bot per call", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        AVAX: {
          avgRate: 0.00009,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
        XRP: {
          avgRate: 0.00008,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: {},
        },
      },
    };
    const bots = [
      {
        id: "funding-phoebe",
        strategyKey: "funding-phoebe",
        config: { fundingThreshold: 0.0001, minVenueAgreement: 3 },
      },
    ];
    const out = detectNearTradeCandidates({ bots, signals });
    expect(out).toHaveLength(1);
  });

  it("skips trend strategies entirely (no meaningful 'near' state)", () => {
    const signals: ExternalSignals = { liquidations: [], funding: {} };
    const bots = [
      {
        id: "boomer-trend",
        strategyKey: "boomer-trend",
        config: { fastPeriod: 7, slowPeriod: 21 },
      },
    ];
    expect(detectNearTradeCandidates({ bots, signals })).toHaveLength(0);
  });
});
