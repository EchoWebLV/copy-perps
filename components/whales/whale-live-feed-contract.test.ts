import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WhaleLiveFeed position card contract", () => {
  it("renders the entry chart for every position card instead of only the active slide", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleLiveFeed.tsx"),
      "utf8",
    );

    expect(source).not.toContain("showChart={i === activeIdx}");
    expect(source).not.toContain("showChart && chartPosition");
    expect(source).toContain("<LiveEntryChart pos={chartPosition} />");
  });

  it("keeps live position cards free of nested card scrolling and analysis copy", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleLiveFeed.tsx"),
      "utf8",
    );

    expect(source).not.toContain("overflow-y-auto pr-1");
    expect(source).not.toContain("<AnalysisBlock");
    expect(source).not.toContain("Analysis is warming up");
  });
});
