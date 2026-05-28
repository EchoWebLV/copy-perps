import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WhaleMarketHeatmap contract", () => {
  it("replaces the visible /live whale route while keeping the swipe feed as a hidden mode", () => {
    const routeSource = readFileSync(
      join(process.cwd(), "app/(app)/live/page.tsx"),
      "utf8",
    );

    expect(routeSource).toContain("WhaleMarketHeatmap");
    expect(routeSource).toContain("<WhaleMarketHeatmap initialPositions={positions} />");
    expect(routeSource).toContain('params.mode === "swipe"');
    expect(routeSource).toContain("<WhaleLiveFeed initialPositions={positions} />");
    expect(
      existsSync(join(process.cwd(), "components/whales/WhaleLiveFeed.tsx")),
    ).toBe(true);
  });

  it("summarizes market-level long and short whale money", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleMarketHeatmap.tsx"),
      "utf8",
    );

    expect(source).toContain("buildMarketHeatRows");
    expect(source).toContain("longNotional");
    expect(source).toContain("shortNotional");
    expect(source).toContain("Long Money");
    expect(source).toContain("Short Money");
  });

  it("surfaces fast market read leaders for each market", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleMarketHeatmap.tsx"),
      "utf8",
    );

    expect(source).toContain("Top Whale");
    expect(source).toContain("Biggest Position");
    expect(source).toContain("Newest Open");
    expect(source).toContain("Strongest P/L");
  });

  it("keeps refreshing live whale positions without blocking the route", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleMarketHeatmap.tsx"),
      "utf8",
    );

    expect(source).toContain("/api/whales/live?limit=1000");
    expect(source).toContain("useVisiblePoll");
  });
});
