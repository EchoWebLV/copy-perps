import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WhaleRoster feed layout", () => {
  it("renders whales as one snap-scroll card per screen instead of a multi-column grid", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain("snap-y snap-mandatory");
    expect(source).toContain("h-full w-full snap-start");
    expect(source).not.toContain("lg:grid-cols");
    expect(source).not.toContain("auto-rows-max");
  });

  it("does not reserve a title band above the whale cards", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).not.toContain('{`"WHALES"`}');
    expect(source).not.toContain("Ranked source accounts ready to copy");
    expect(source).not.toContain("pt-[150px]");
    expect(source).not.toContain("lg:pt-[118px]");
  });

  it("renders a loading shell and starts the roster fetch immediately", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain("<LoadingRoster />");
    expect(source).toContain("setLoaded(true)");
    expect(source).toContain("run();");
  });

  it("polls the roster at a slower cadence to keep route transitions responsive", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain("const POLL_MS = 30_000;");
  });

  it("shows hold duration for the position surfaced on the whale card", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain("formatWhalePositionAge");
    expect(source).toContain("Held");
    expect(source).toContain("largest.openedAtMs");
  });

  it("does not present unavailable Hyperliquid portfolio stats as real zeroes", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleRoster.tsx"),
      "utf8",
    );

    expect(source).toContain('statsSource === "live_positions"');
    expect(source).toContain('"Live P/L"');
    expect(source).toContain("formatPeriodPnl");
    expect(source).toContain('historyLabel={livePositionStatsOnly ? "P&L history" : "All time P&L"}');
    expect(source).toContain("P&L HISTORY UNAVAILABLE");
  });
});
