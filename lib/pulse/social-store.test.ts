import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizePulseCommentBody,
  normalizePulseReaction,
  PULSE_SOCIAL_REACTIONS,
} from "./social-store";

describe("Pulse social store helpers", () => {
  it("accepts only supported Pulse reactions", () => {
    expect(PULSE_SOCIAL_REACTIONS).toEqual(["Tailing", "Bullish", "Bearish"]);
    expect(normalizePulseReaction("Tailing")).toBe("Tailing");
    expect(normalizePulseReaction("Bullish")).toBe("Bullish");
    expect(normalizePulseReaction("Bearish")).toBe("Bearish");
    expect(normalizePulseReaction("Watching")).toBeNull();
    expect(normalizePulseReaction(null)).toBeNull();
  });

  it("trims comments and rejects empty or oversized bodies", () => {
    expect(normalizePulseCommentBody("  good tail?  ")).toBe("good tail?");
    expect(normalizePulseCommentBody("   ")).toBeNull();
    expect(normalizePulseCommentBody("x".repeat(281))).toBeNull();
  });

  it("hydrates comments and recent reactions with real user profiles", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/pulse/social-store.ts"),
      "utf8",
    );

    expect(source).toContain("buildPublicUserProfile");
    expect(source).toContain("recentReactors");
    expect(source).toContain("users");
    expect(source).not.toContain("traderAlias");
    expect(source).not.toContain("Trader ${");
  });
});
