import { describe, expect, it } from "vitest";

import { applyLiveMarksToCopyRows } from "./live-copy-row";
import type { CopyRowData } from "@/components/portfolio/CopyRow";

describe("applyLiveMarksToCopyRows", () => {
  it("values an open copy row from live marks when the server row is blank", () => {
    const rows: CopyRowData[] = [
      {
        betId: "copy-near-short",
        venue: "pacifica",
        sourceKind: "tail",
        market: "NEAR",
        side: "short",
        leverage: 10,
        stakeUsdc: 10,
        leaderAddress: "0x023a",
        leaderUsername: null,
        botId: null,
        botName: null,
        liveStatus: "open",
        entryPrice: 2.4,
        markPrice: null,
        pricedAt: null,
        liquidationPrice: null,
        amountBase: 4,
        marginUsd: null,
        marginMode: "cross",
        notionalUsd: null,
        pnlUsd: null,
        unrealizedPnlPct: null,
        openedAt: "2026-05-28T12:00:00.000Z",
        positionUpdatedAt: "2026-05-28T12:00:00.000Z",
        leaderClosedAt: null,
      },
    ];

    const result = applyLiveMarksToCopyRows(rows, { NEAR: 2.3 }, {
      pricedAt: "2026-05-28T12:01:00.000Z",
    });

    expect(result[0]).toMatchObject({
      markPrice: 2.3,
      pricedAt: "2026-05-28T12:01:00.000Z",
      notionalUsd: 9.2,
      pnlUsd: 0.4,
      unrealizedPnlPct: 4,
    });
    expect(rows[0].markPrice).toBeNull();
  });
});
