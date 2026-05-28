import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TailModal single whale leverage control", () => {
  it("shows a leverage override only for a single whale position", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );

    expect(source).toContain("showWhaleLeverageControl");
    expect(source).toContain("isSingleWhalePosition");
    expect(source).toContain("Tail leverage");
    expect(source).toContain("Decrease leverage");
    expect(source).toContain("Increase leverage");
    expect(source).toContain("setWhaleLeverage");
    expect(source).toContain("tailLeverageBounds");
    expect(source).toContain("Max {maxWhaleLeverage}x");
  });

  it("sends the selected leverage through the Flash copy request", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );

    expect(source).toContain('fetch("/api/flash/perp"');
    expect(source).toContain("const flashLeverage =");
    expect(source).toContain(
      "copyLeverage ?? copyPosition?.leverage ?? source.leverage",
    );
    expect(source).toContain("leverage: flashLeverage");
    expect(source).not.toContain('fetch("/api/bet/whale"');
  });

  it("keeps the copied leverage as default while using Flash max as the slider ceiling", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );

    expect(source).toContain("maxFlashLeverageForMarket");
    expect(source).toContain("activeFlashMaxLeverage");
    expect(source).toContain(
      "activeFlashMaxLeverage ?? activeWhalePosition?.maxLeverage ?? source.maxLeverage",
    );
    expect(source).toContain("source.positions[0]?.leverage ?? source.leverage");
  });
});
