import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash perps service pool routing contract", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "lib/flash/perps.ts"), "utf8");

  it("routes open, close, and position reads through the selected Flash pool", () => {
    const text = source();

    expect(text).toContain("flashPoolNameForMarket");
    expect(text).toContain("poolConfigForMarket");
    expect(text).toContain("poolConfigByName");
    expect(text).toContain("for (const poolConfig of this.poolConfigs)");
    expect(text).toContain("this.createClient(owner, poolConfig)");
    expect(text).toContain("this.marketForSymbol(poolConfig, req.market, req.side)");
    expect(text).not.toContain("const FLASH_POOL_NAME");
  });

  it("does not render dynamic close-quote leverage as the opened position leverage", () => {
    const text = source();

    expect(text).not.toContain("leverage: bnToNumber(quote.existingLeverage");
    expect(text).toContain("leverageFromPositionCollateral");
  });
});
