import { describe, expect, it } from "vitest";

import {
  mergeCopyRowsForPortfolioRefresh,
  type PortfolioCopyRowRefreshShape,
} from "./portfolio-refresh";

describe("mergeCopyRowsForPortfolioRefresh", () => {
  it("keeps the last live row values when a refresh returns syncing placeholders", () => {
    const current: PortfolioCopyRowRefreshShape[] = [
      {
        betId: "tail-1",
        market: "BTC",
        side: "long" as const,
        liveStatus: "open" as const,
        markPrice: 72_900,
        notionalUsd: 249.5,
        pnlUsd: 0.42,
        unrealizedPnlPct: 4.2,
        pricedAt: "2026-05-28T12:00:00.000Z",
      },
    ];
    const next: PortfolioCopyRowRefreshShape[] = [
      {
        betId: "tail-1",
        market: "BTC",
        side: "long" as const,
        liveStatus: "unknown" as const,
        markPrice: null,
        notionalUsd: null,
        pnlUsd: null,
        unrealizedPnlPct: null,
        pricedAt: null,
      },
    ];

    expect(mergeCopyRowsForPortfolioRefresh(current, next)).toEqual([
      {
        ...next[0],
        liveStatus: "open",
        markPrice: 72_900,
        notionalUsd: 249.5,
        pnlUsd: 0.42,
        unrealizedPnlPct: 4.2,
        pricedAt: "2026-05-28T12:00:00.000Z",
      },
    ]);
  });

  it("uses fresh live rows when the refresh has live values", () => {
    const current = [
      {
        betId: "tail-1",
        market: "BTC",
        side: "long" as const,
        liveStatus: "open" as const,
        markPrice: 72_900,
        notionalUsd: 249.5,
        pnlUsd: 0.42,
        unrealizedPnlPct: 4.2,
        pricedAt: "2026-05-28T12:00:00.000Z",
      },
    ];
    const next = [
      {
        betId: "tail-1",
        market: "BTC",
        side: "long" as const,
        liveStatus: "open" as const,
        markPrice: 73_100,
        notionalUsd: 250.2,
        pnlUsd: 0.7,
        unrealizedPnlPct: 7,
        pricedAt: "2026-05-28T12:00:03.000Z",
      },
    ];

    expect(mergeCopyRowsForPortfolioRefresh(current, next)).toEqual(next);
  });
});
