import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WhaleAnalysisStream position timing copy", () => {
  it("shows holding duration from openedAt instead of watcher last-seen recency", () => {
    const source = readFileSync(
      join(process.cwd(), "components/whales/WhaleAnalysisStream.tsx"),
      "utf8",
    );

    expect(source).toContain("formatWhalePositionTime");
    expect(source).toContain("const positionTime = formatWhalePositionTime(p, now);");
    expect(source).toContain("{positionTime.label.toUpperCase()} {positionTime.value}");
    expect(source).not.toContain("formatWhalePositionAge");
    expect(source).not.toContain("seen {fmtAge(p.lastSeenAtMs, now)}");
    expect(source).not.toContain("function fmtAge");
  });
});
