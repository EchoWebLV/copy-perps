// lib/flash-v2/accounting.test.ts
import { describe, expect, it } from "vitest";
import { availableUsdc } from "./accounting";

describe("availableUsdc", () => {
  it("nets ledger deposits against basket debits + pending credits", () => {
    expect(
      availableUsdc({ ledgerDeposits: 100, basketDebits: 30, basketPendingCredits: 5 }),
    ).toBe(75);
  });
  it("never goes negative", () => {
    expect(
      availableUsdc({ ledgerDeposits: 10, basketDebits: 40, basketPendingCredits: 0 }),
    ).toBe(0);
  });
  it("rounds to 6 USDC decimals", () => {
    expect(
      availableUsdc({ ledgerDeposits: 1.0000005, basketDebits: 0, basketPendingCredits: 0 }),
    ).toBe(1.000001);
  });
});
