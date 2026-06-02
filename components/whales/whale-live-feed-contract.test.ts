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

  it("does not show watcher last-seen recency on the position card", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleLiveFeed.tsx"),
      "utf8",
    );

    expect(source).toContain("formatWhalePositionTime");
    expect(source).toContain("const positionTime = formatWhalePositionTime(p, now);");
    expect(source).toContain("{positionTime.label.toUpperCase()} {positionTime.value}");
    expect(source).not.toContain("formatWhalePositionAge");
  });

  it("does not reserve title space above live position cards", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleLiveFeed.tsx"),
      "utf8",
    );

    expect(source).not.toContain('{`"LIVE POSITIONS"`}');
    expect(source).not.toContain("Open source positions");
    expect(source).not.toContain("LIVE POSITIONS");
    expect(source).not.toContain("pt-[72px]");
    expect(source).not.toContain("pl-[80px]");
  });

  it("surfaces every market but gates tailability per card", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleLiveFeed.tsx"),
      "utf8",
    );

    // The feed no longer hides non-Flash markets...
    expect(source).not.toContain(
      "isFlashCopyableMarket(position.payload.market)",
    );
    // ...but the Tail button is still gated per position.
    expect(source).toContain("const canTail = isFlashCopyableMarket(p.market);");
    expect(source).not.toContain("const canTail = now > 0 && !stale");
  });

  it("renders source P/L as a yellow brush stroke", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleLiveFeed.tsx"),
      "utf8",
    );

    expect(source).toContain("PNL_BRUSH_STROKES");
    expect(source).toContain("<PnlBrushStroke");
    expect(source).toContain('background: "#f5d84b"');
  });
});
