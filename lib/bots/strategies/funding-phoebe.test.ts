import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  FundingPhoebeStrategy,
  FundingPhoebeLiteStrategy,
} from "./funding-phoebe";
import type { MarketContext, ExternalSignals, PaperPosition } from "../types";

const baseCtx: MarketContext = { asset: "BTC", mark: 80_000 };

describe("FundingPhoebe.evaluateEntry", () => {
  it("returns null when funding is below threshold", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        BTC: {
          avgRate: 0.00005,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: { binance: 0.00005, bybit: 0.00005, okx: 0.00005, dydx: 0.00005 },
        },
      },
    };
    expect(FundingPhoebeStrategy.evaluateEntry(baseCtx, signals)).toBeNull();
  });

  it("shorts when funding is positive above the headliner threshold (10 bps)", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        BTC: {
          avgRate: 0.0002,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: { binance: 0.0002, bybit: 0.00019, okx: 0.00021, dydx: 0.0002 },
        },
      },
    };
    const decision = FundingPhoebeStrategy.evaluateEntry(baseCtx, signals);
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("short");
    expect(decision!.asset).toBe("BTC");
  });

  it("longs when funding is negative below the headliner threshold", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        BTC: {
          avgRate: -0.0002,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: { binance: -0.0002, bybit: -0.00019, okx: -0.00021, dydx: -0.0002 },
        },
      },
    };
    const decision = FundingPhoebeStrategy.evaluateEntry(baseCtx, signals);
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("long");
  });

  it("returns null when asset has no funding data", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        ETH: {
          avgRate: 0.0005,
          venuesAgreed: 4,
          venuesQueried: 4,
          perVenue: { binance: 0.0005, bybit: 0.0005, okx: 0.0005, dydx: 0.0005 },
        },
      },
    };
    expect(FundingPhoebeStrategy.evaluateEntry(baseCtx, signals)).toBeNull();
  });

  it("does not fire when only 1 venue agrees (below minVenueAgreement)", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        BTC: {
          avgRate: 0.0002,
          venuesAgreed: 1, // only Binance — headliner needs 3
          venuesQueried: 4,
          perVenue: { binance: 0.0002, bybit: -0.00005, okx: -0.00008, dydx: -0.00003 },
        },
      },
    };
    expect(FundingPhoebeStrategy.evaluateEntry(baseCtx, signals)).toBeNull();
    // Lite variant (minVenueAgreement: 2) ALSO doesn't fire on 1 venue:
    expect(FundingPhoebeLiteStrategy.evaluateEntry(baseCtx, signals)).toBeNull();
  });
});

describe("FundingPhoebeLite (variant)", () => {
  it("fires at a lower threshold than the headliner (5 bps vs 10 bps)", () => {
    const signals: ExternalSignals = {
      liquidations: [],
      funding: {
        BTC: {
          avgRate: 0.00007,
          venuesAgreed: 3,
          venuesQueried: 4,
          perVenue: { binance: 0.00007, bybit: 0.00008, okx: 0.00006, dydx: -0.00001 },
        },
      },
    };
    expect(FundingPhoebeStrategy.evaluateEntry(baseCtx, signals)).toBeNull();
    const decision = FundingPhoebeLiteStrategy.evaluateEntry(baseCtx, signals);
    expect(decision).not.toBeNull();
    expect(decision!.side).toBe("short");
  });
});

describe("FundingPhoebe.evaluateExit", () => {
  const openShort: PaperPosition = {
    id: "p1",
    botId: "funding-phoebe",
    asset: "BTC",
    side: "short",
    leverage: 20,
    stakeUsd: 100,
    entryMark: 80_000,
    entryTs: new Date(),
    exitMark: null,
    exitTs: null,
    paperPnlUsd: null,
    triggerMeta: { avgRate: 0.0002 },
    narrationOpen: null,
    narrationClose: null,
    status: "open",
  };

  it("does not exit while position is fresh and price is flat", () => {
    const recent: PaperPosition = {
      ...openShort,
      entryTs: new Date(Date.now() - 1_000),
    };
    expect(
      FundingPhoebeStrategy.evaluateExit(
        { asset: "BTC", mark: 80_000 },
        recent,
      ),
    ).toBe(false);
  });

  it("exits after 4h max hold", () => {
    const old: PaperPosition = {
      ...openShort,
      entryTs: new Date(Date.now() - 5 * 60 * 60 * 1000),
    };
    expect(
      FundingPhoebeStrategy.evaluateExit(
        { asset: "BTC", mark: 80_000 },
        old,
      ),
    ).toBe(true);
  });

  it("exits on a 0.8% favorable move", () => {
    expect(
      FundingPhoebeStrategy.evaluateExit(
        { asset: "BTC", mark: 79_360 },
        openShort,
      ),
    ).toBe(true);
  });
});
