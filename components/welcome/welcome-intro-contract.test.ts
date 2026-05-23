import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app welcome overlay contract", () => {
  it("does not mount a blocking welcome overlay above app controls", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/layout.tsx"),
      "utf8",
    );

    expect(source).not.toContain("WelcomeIntro");
  });
});
