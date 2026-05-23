import { describe, expect, it } from "vitest";

import { shouldAutoCloseWhaleCopy } from "./source-close";
import type { WhaleCopyMeta } from "./whale-meta";

const meta: WhaleCopyMeta = {
  sourceType: "whale",
  whaleId: "pacifica:ABC123",
  source: "pacifica",
  sourceAccount: "ABC123",
  sourcePositionId: "pos1",
  leaderMarket: "BTC",
  leaderSide: "long",
  leverage: 10,
  autoCloseOnSourceClose: true,
  userEntryPrice: 65_100,
  sourceEntryPriceAtCopy: 65_000,
  pacificaOrderId: "order1",
  closeReason: null,
};

describe("source close eligibility", () => {
  it("auto-closes only when enabled and source is closed", () => {
    expect(
      shouldAutoCloseWhaleCopy({
        meta,
        sourceStillOpen: false,
      }),
    ).toBe(true);
  });

  it("does not auto-close when the user disabled close listening", () => {
    expect(
      shouldAutoCloseWhaleCopy({
        meta: { ...meta, autoCloseOnSourceClose: false },
        sourceStillOpen: false,
      }),
    ).toBe(false);
  });

  it("does not auto-close while source is still open", () => {
    expect(
      shouldAutoCloseWhaleCopy({
        meta,
        sourceStillOpen: true,
      }),
    ).toBe(false);
  });
});
