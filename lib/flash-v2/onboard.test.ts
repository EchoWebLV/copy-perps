// lib/flash-v2/onboard.test.ts
import { describe, expect, it, vi } from "vitest";
import { needsOnboarding, buildOnboardingSteps } from "./onboard";

describe("onboarding", () => {
  it("needsOnboarding is true only when the basket PDA is null", () => {
    expect(needsOnboarding(null)).toBe(true);
    expect(needsOnboarding("Bskt111")).toBe(false);
  });

  it("builds the three setup steps in the chain-enforced order, all on base layer", async () => {
    const calls: string[] = [];
    const fakeTx = {} as never;
    const postBuilder = vi.fn(async (path: string) => {
      calls.push(path);
      return { tx: fakeTx, raw: {} };
    });
    const steps = await buildOnboardingSteps("owner1", { postBuilder: postBuilder as never });
    expect(steps.map((s) => s.name)).toEqual([
      "init-basket",
      "init-deposit-ledger",
      "delegate-basket",
    ]);
    expect(steps.every((s) => s.unsigned.layer === "base")).toBe(true);
    expect(calls).toEqual([
      "/transaction-builder/init-basket",
      "/transaction-builder/init-deposit-ledger",
      "/transaction-builder/delegate-basket",
    ]);
  });
});
