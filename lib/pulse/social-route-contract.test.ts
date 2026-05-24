import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pulse social API route", () => {
  it("exposes database-backed read and write handlers", () => {
    const source = readFileSync(
      join(process.cwd(), "app/api/pulse/social/route.ts"),
      "utf8",
    );

    expect(source).toContain("export async function GET");
    expect(source).toContain("export async function POST");
    expect(source).toContain("verifyPrivyRequest");
    expect(source).toContain("ensureUser");
    expect(source).toContain("getPulseSocial");
    expect(source).toContain("setPulseReaction");
    expect(source).toContain("addPulseComment");
  });
});
