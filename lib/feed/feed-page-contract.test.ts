import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("feed page contract", () => {
  it("uses the unified whales+bots feed as the first-tab surface", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/feed/page.tsx"),
      "utf8",
    );

    expect(source).toContain("UnifiedFeed");
    expect(source).not.toContain("WhaleRoster");
    // SSR hydration: roster is fetched server-side (with a hard time budget)
    // so a warm cache paints whales on first byte instead of a loader.
    expect(source).toContain("buildCompactRosterWithTimeout");
    expect(source).toContain("initialWhales={initialWhales}");
    expect(source).not.toContain("initialWhales={[]}");
    expect(source).toContain('<AppShell railTitle="Traders" hideEmptyRail>');
    expect(source).not.toContain("buildWhaleTraderSignals");
    expect(source).not.toContain("buildWhalePositionSignals");
  });
});
