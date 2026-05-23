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
});
