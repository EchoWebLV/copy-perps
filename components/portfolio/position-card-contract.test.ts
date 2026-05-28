import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Portfolio position cards", () => {
  const copyRow = () =>
    readFileSync(join(process.cwd(), "components/portfolio/CopyRow.tsx"), "utf8");
  const positionRow = () =>
    readFileSync(
      join(process.cwd(), "components/portfolio/PositionRow.tsx"),
      "utf8",
    );

  it("makes live copy positions read like large trading cards", () => {
    const source = copyRow();

    expect(source).toContain("PositionHeroMetric");
    expect(source).toContain("PositionDetailGrid");
    expect(source).toContain("text-[22px]");
    expect(source).toContain("P/L");
    expect(source).toContain("Notional");
  });

  it("lets unmatched wallet positions close through the self-trade close route", () => {
    const source = copyRow();

    expect(source).toContain('sourceKind?: "tail" | "wallet"');
    expect(source).toContain("/api/trade/perp/close");
    expect(source).toContain('row.sourceKind === "wallet"');
  });

  it("makes legacy open and closed positions use the same card language", () => {
    const source = positionRow();

    expect(source).toContain("LegacyPositionMetric");
    expect(source).toContain("text-[20px]");
    expect(source).toContain("Current");
    expect(source).toContain("Cost");
  });
});
