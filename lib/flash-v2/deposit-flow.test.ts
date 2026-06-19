import { describe, expect, it, vi } from "vitest";
import { planFlashV2Deposit } from "./deposit-flow";

const fakeTx = (n: number) => ({ serialize: () => new Uint8Array([n]) }) as never;

describe("planFlashV2Deposit", () => {
  it("returns the onboard phase with serialized steps when not onboarded", async () => {
    const venue = {
      ensureOnboarded: vi.fn(async () => [
        { name: "init-basket", unsigned: { tx: fakeTx(1), layer: "base" } },
        { name: "delegate-basket", unsigned: { tx: fakeTx(2), layer: "base" } },
      ]),
      deposit: vi.fn(),
    };
    const plan = await planFlashV2Deposit({
      venue: venue as never,
      owner: "o",
      amountUsdc: 25,
      tokenMint: "MINT",
    });
    expect(plan.phase).toBe("onboard");
    if (plan.phase === "onboard") {
      expect(plan.steps.map((s) => s.name)).toEqual(["init-basket", "delegate-basket"]);
      expect(plan.steps[0]!.layer).toBe("base");
      expect(plan.steps[0]!.transactionB64).toBe(Buffer.from([1]).toString("base64"));
    }
    expect(venue.deposit).not.toHaveBeenCalled();
  });

  it("returns the deposit phase (base layer) when already onboarded", async () => {
    const venue = {
      ensureOnboarded: vi.fn(async () => []),
      deposit: vi.fn(async () => ({ tx: fakeTx(9), layer: "base" })),
    };
    const plan = await planFlashV2Deposit({
      venue: venue as never,
      owner: "o",
      amountUsdc: 25,
      tokenMint: "MINT",
    });
    expect(plan.phase).toBe("deposit");
    if (plan.phase === "deposit") {
      expect(plan.depositTransaction).toBe(Buffer.from([9]).toString("base64"));
      expect(plan.layer).toBe("base");
    }
    expect(venue.deposit).toHaveBeenCalledWith({ owner: "o", amountUsdc: 25, tokenMint: "MINT" });
  });
});
