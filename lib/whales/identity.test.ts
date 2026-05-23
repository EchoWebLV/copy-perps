import { describe, expect, it } from "vitest";
import {
  makeWhaleId,
  makeWhalePositionId,
  generatedWhaleHandle,
  isSourceFresh,
} from "./identity";

describe("whale identity", () => {
  it("builds stable whale ids by source and account", () => {
    expect(makeWhaleId("pacifica", "ABC123")).toBe("pacifica:ABC123");
    expect(makeWhaleId("hyperliquid", "0xabc")).toBe("hyperliquid:0xabc");
  });

  it("builds stable position ids from source, account, market, side, and openedAt", () => {
    expect(
      makeWhalePositionId({
        source: "pacifica",
        sourceAccount: "ABC123",
        market: "BTC",
        side: "long",
        openedAtMs: 1779543000000,
      }),
    ).toBe("pacifica:ABC123:BTC:long:1779543000000");
  });

  it("generates public handles without exposing full addresses", () => {
    expect(generatedWhaleHandle("ABC123xyz")).toBe("whale_ABC1");
    expect(generatedWhaleHandle("")).toBe("whale_anon");
  });

  it("treats source data older than the max age as stale", () => {
    expect(isSourceFresh(Date.now() - 30_000, 60_000)).toBe(true);
    expect(isSourceFresh(Date.now() - 61_000, 60_000)).toBe(false);
  });
});
