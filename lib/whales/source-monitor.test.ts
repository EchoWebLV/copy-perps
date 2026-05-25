import { describe, expect, it, vi } from "vitest";

import {
  hyperliquidUserFillsSubscription,
  isHyperliquidPositionEvent,
  isPacificaPositionEvent,
  makeDebouncedSourceTrigger,
  pacificaAccountPositionsSubscription,
} from "./source-monitor";

describe("whale source monitor contracts", () => {
  it("builds Hyperliquid userFills subscriptions for source accounts", () => {
    expect(hyperliquidUserFillsSubscription("0xabc")).toEqual({
      method: "subscribe",
      subscription: {
        type: "userFills",
        user: "0xabc",
      },
    });
  });

  it("builds Pacifica account_positions subscriptions for source accounts", () => {
    expect(pacificaAccountPositionsSubscription("pacifica-account")).toEqual({
      method: "subscribe",
      params: {
        source: "account_positions",
        account: "pacifica-account",
      },
    });
  });

  it("triggers on streaming Hyperliquid user fills but ignores snapshots", () => {
    expect(
      isHyperliquidPositionEvent({
        channel: "userFills",
        data: {
          isSnapshot: true,
          user: "0xabc",
          fills: [{ coin: "ETH", dir: "Close Long" }],
        },
      }),
    ).toBe(false);

    expect(
      isHyperliquidPositionEvent({
        channel: "userFills",
        data: {
          isSnapshot: false,
          user: "0xabc",
          fills: [{ coin: "ETH", dir: "Close Long" }],
        },
      }),
    ).toBe(true);
  });

  it("triggers on Pacifica account position updates after the subscribe ack", () => {
    expect(
      isPacificaPositionEvent({
        channel: "subscribe",
        data: {
          source: "account_positions",
          account: "pacifica-account",
        },
      }),
    ).toBe(false);

    expect(
      isPacificaPositionEvent({
        channel: "account_positions",
        data: [],
        li: 1559438203,
      }),
    ).toBe(true);
  });

  it("coalesces rapid source updates into one forced reconciliation", async () => {
    vi.useFakeTimers();
    const reconcile = vi.fn(async () => undefined);
    const trigger = makeDebouncedSourceTrigger({
      delayMs: 250,
      reconcile,
    });

    trigger("first");
    trigger("second");
    await vi.advanceTimersByTimeAsync(249);
    expect(reconcile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({
      forceSourceFetch: true,
      reason: "second",
    });
    vi.useRealTimers();
  });
});
