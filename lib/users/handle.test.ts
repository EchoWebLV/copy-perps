import { describe, expect, it } from "vitest";
import { handleFromPubkey, normalizeHandleInput } from "./handle";

describe("user handles", () => {
  it("keeps wallet fallback handles stable", () => {
    expect(handleFromPubkey("4Hx2k4mR9Wallet")).toBe("gwk_4Hx2");
  });

  it("normalizes custom @ handles for public sharing", () => {
    expect(normalizeHandleInput("  @FastBet_01  ")).toEqual({
      ok: true,
      handle: "fastbet_01",
    });
  });

  it("rejects handles that cannot be shared cleanly", () => {
    expect(normalizeHandleInput("@ab")).toEqual({
      ok: false,
      error: "Handle must be 3 to 24 letters, numbers, or underscores.",
    });
    expect(normalizeHandleInput("@fast-bet")).toEqual({
      ok: false,
      error: "Handle must be 3 to 24 letters, numbers, or underscores.",
    });
  });
});
