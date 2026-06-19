// lib/flash-v2/builder.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { postBuilder } from "./builder";
import { FlashV2Error } from "./errors";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status, json: async () => body })),
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
});
