import { describe, expect, it } from "vitest";
import {
  OSTIUM_MAPPED_PAIR_IDS,
  ostiumPairToFlashSymbol,
} from "./ostium-markets";

describe("ostium-markets", () => {
  it("maps Ostium pair ids to Flash symbols", () => {
    expect(ostiumPairToFlashSymbol("5")).toBe("XAU"); // gold
    expect(ostiumPairToFlashSymbol("7")).toBe("CRUDEOIL"); // CL -> CRUDEOIL
    expect(ostiumPairToFlashSymbol("2")).toBe("EUR");
    expect(ostiumPairToFlashSymbol("4")).toBe("USDJPY"); // USD/JPY
    expect(ostiumPairToFlashSymbol("10")).toBe("SPY"); // SPX -> SPY
    expect(ostiumPairToFlashSymbol("18")).toBe("NVDA");
    expect(ostiumPairToFlashSymbol("41")).toBe("HYPE");
  });

  it("returns null for unmapped pairs", () => {
    expect(ostiumPairToFlashSymbol("16")).toBeNull(); // USD/CAD - not a Flash market
    expect(ostiumPairToFlashSymbol("999")).toBeNull();
  });

  it("exposes exactly the 17 mapped pair ids", () => {
    expect(OSTIUM_MAPPED_PAIR_IDS).toHaveLength(17);
    expect(new Set(OSTIUM_MAPPED_PAIR_IDS).size).toBe(17);
  });
});
