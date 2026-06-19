// lib/flash-v2/builder.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { postBuilder } from "./builder";
import {
  FlashV2Error,
  FlashOnboardingRequiredError,
  FlashWithdrawSettlingError,
} from "./errors";

afterEach(() => vi.unstubAllGlobals());

/** Simulate a real Response: object bodies serialize to JSON, string bodies are
 *  returned verbatim (the 400/500 plain-text error channels). */
function mockFetch(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status, text: async () => text })),
  );
}

describe("postBuilder", () => {
  it("deserializes the returned base64 transaction", async () => {
    const sentinel = {} as VersionedTransaction;
    vi.spyOn(VersionedTransaction, "deserialize").mockReturnValue(sentinel);
    mockFetch(200, { transactionBase64: "AA==" });
    const out = await postBuilder("/transaction-builder/deposit-direct", { owner: "x" });
    expect(out.tx).toBe(sentinel);
  });
  it("throws a typed error when the 200 body carries err", async () => {
    mockFetch(200, { err: "insufficient collateral" });
    await expect(
      postBuilder("/transaction-builder/open-position", {}),
    ).rejects.toBeInstanceOf(FlashV2Error);
  });
  it("throws when no transaction is returned", async () => {
    mockFetch(200, { ok: true });
    await expect(postBuilder("/transaction-builder/init-basket", {})).rejects.toThrow(
      /no transaction/i,
    );
  });
  it("classifies a 400 plain-text body as onboarding-required", async () => {
    mockFetch(400, "basket account not initialized");
    await expect(
      postBuilder("/transaction-builder/open-position", {}),
    ).rejects.toBeInstanceOf(FlashOnboardingRequiredError);
  });
  it("classifies a 500 plain-text 0xbc4 body as withdraw-settling", async () => {
    mockFetch(500, "Program failed to complete: custom program error: 0xbc4");
    await expect(
      postBuilder("/transaction-builder/execute-withdrawal", {}),
    ).rejects.toBeInstanceOf(FlashWithdrawSettlingError);
  });
});
