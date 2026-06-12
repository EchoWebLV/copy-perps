import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fmtOraclePrice,
  isOracleSymbol,
  shortAddress,
} from "./ScalpOracleHero";

describe("fmtOraclePrice (template-style readout)", () => {
  it("4 decimals under $1k, 2 above", () => {
    expect(fmtOraclePrice(66.7863)).toBe("66.7863");
    expect(fmtOraclePrice(1668.13)).toBe("1,668.13");
    expect(fmtOraclePrice(63599.694)).toBe("63,599.69");
  });
});

describe("isOracleSymbol", () => {
  it("covers exactly the ER-fed markets", () => {
    expect(isOracleSymbol("SOL")).toBe(true);
    expect(isOracleSymbol("BTC")).toBe(true);
    expect(isOracleSymbol("ETH")).toBe(true);
    expect(isOracleSymbol("WIF")).toBe(false);
  });
});

describe("shortAddress", () => {
  it("shortens long base58, keeps short strings", () => {
    expect(shortAddress("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu")).toBe(
      "ENYw…4jPu",
    );
    expect(shortAddress("short")).toBe("short");
  });
});

describe("hero wiring contract", () => {
  it("hero + footer mount in the live-chart section", () => {
    const source = readFileSync(
      join(process.cwd(), "components/trade/FastPerpsGame.tsx"),
      "utf8",
    );
    expect(source).toContain("<ScalpOracleHero market={market} />");
    expect(source).toContain("<ScalpOracleFooter market={market} />");
  });

  it("provider throttles flushes (no per-push re-render)", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/flash/live-prices-context.tsx"),
      "utf8",
    );
    expect(source).toContain("ORACLE_FLUSH_MS = 120");
    expect(source).toContain("useFlashOracleStats");
  });
});
