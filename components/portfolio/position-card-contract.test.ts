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

  it("keeps live copy positions compact and action-focused", () => {
    const source = copyRow();

    expect(source).toContain("CompactPositionMetric");
    expect(source).not.toContain("PositionHeroMetric");
    expect(source).not.toContain("PositionDetailGrid");
    expect(source).not.toContain("text-[22px]");
    expect(source).not.toContain('label="Entry"');
    expect(source).not.toContain('label="Liq"');
    expect(source).not.toContain('label="Margin"');
    expect(source).not.toContain('label="Mode"');
    expect(source).toContain("P/L");
    expect(source).toContain("Notional");
  });

  it("lets unmatched wallet positions close through the self-trade close route", () => {
    const source = copyRow();

    expect(source).toContain('sourceKind?: "tail" | "wallet"');
    expect(source).toContain("/api/trade/perp/close");
    expect(source).toContain('row.sourceKind === "wallet"');
  });

  it("keeps legacy open and closed positions in a slim row layout", () => {
    const source = positionRow();

    expect(source).toContain("CompactLegacyMetric");
    expect(source).not.toContain("LegacyPositionMetric");
    expect(source).not.toContain("text-[20px]");
    expect(source).not.toContain("shadow-[");
    expect(source).toContain("Current");
    expect(source).toContain("Cost");
  });
});
