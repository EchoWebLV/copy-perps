import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Mobile presentation route", () => {
  const pagePath = join(process.cwd(), "app/mobile/page.tsx");

  it("renders the real app inside a mobile-sized iframe starting at feed", () => {
    expect(existsSync(pagePath)).toBe(true);

    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain('src="/feed"');
    expect(source).toContain("<iframe");
    expect(source).toContain("gwak.gg mobile app");
    expect(source).toContain("aspect-[390/844]");
  });
});
