import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("feed page contract", () => {
  it("uses the whale roster as the first-tab surface", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/feed/page.tsx"),
      "utf8",
    );

    expect(source).toContain("WhaleRoster");
    expect(source).toContain("initialWhales={[]}");
    expect(source).not.toContain("buildWhaleTraderSignals");
    expect(source).not.toContain("WhaleLiveFeed");
    expect(source).not.toContain("buildWhalePositionSignals");
  });
});
