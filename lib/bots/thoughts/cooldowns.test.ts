import { describe, it, expect } from "vitest";
import { isCooledDown, isUnderGlobalCap } from "./cooldowns";

describe("isCooledDown", () => {
  it("returns true when there is no prior thought", () => {
    expect(isCooledDown(null, 300)).toBe(true);
  });

  it("returns false when the last thought is within the cooldown window", () => {
    const recent = new Date(Date.now() - 100_000); // 100s ago
    expect(isCooledDown(recent, 300)).toBe(false);
  });

  it("returns true when the last thought is older than the cooldown window", () => {
    const old = new Date(Date.now() - 400_000); // 400s ago
    expect(isCooledDown(old, 300)).toBe(true);
  });
});

describe("isUnderGlobalCap", () => {
  it("returns true when count is below cap", () => {
    expect(isUnderGlobalCap(5, 8)).toBe(true);
  });

  it("returns false at exactly the cap", () => {
    expect(isUnderGlobalCap(8, 8)).toBe(false);
  });

  it("returns false above the cap", () => {
    expect(isUnderGlobalCap(12, 8)).toBe(false);
  });
});
