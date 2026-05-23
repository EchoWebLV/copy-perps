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
  });

  it("sends the selected leverage only with whale copy requests", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );

    expect(source).toContain("leverage: copyLeverage");
    expect(source).not.toContain("leverage: copyPosition?.leverage");
  });
});
