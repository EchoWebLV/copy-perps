import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  deriveSessionTokenV2,
  isSessionExpired,
  isSessionExpiringSoon,
  validateSessionConfig,
} from "./session";
import { FlashV2Error } from "./errors";

describe("session derivation + validation", () => {
  const authority = Keypair.generate().publicKey.toBase58();
  const signer = Keypair.generate().publicKey.toBase58();

  it("derives a deterministic SessionTokenV2 PDA off-curve under Keysp", () => {
    const a = deriveSessionTokenV2(authority, signer);
    const b = deriveSessionTokenV2(authority, signer);
    expect(a.toBase58()).toBe(b.toBase58());
    expect(PublicKey.isOnCurve(a.toBytes())).toBe(false); // a PDA is off-curve
  });

  it("derives distinct PDAs per session signer", () => {
    const other = Keypair.generate().publicKey.toBase58();
    expect(deriveSessionTokenV2(authority, signer).toBase58()).not.toBe(
      deriveSessionTokenV2(authority, other).toBase58(),
    );
  });

  it("expiry math is inclusive at the boundary", () => {
    expect(isSessionExpired(100, 99)).toBe(false);
    expect(isSessionExpired(100, 100)).toBe(true);
    expect(isSessionExpiringSoon(100, 80, 30)).toBe(true); // 20s left <= 30
    expect(isSessionExpiringSoon(100, 50, 30)).toBe(false); // 50s left > 30
  });

  it("validateSessionConfig accepts a matching token, rejects a mismatch", () => {
    const token = deriveSessionTokenV2(authority, signer).toBase58();
    expect(() =>
      validateSessionConfig({ owner: authority, signer, sessionToken: token }),
    ).not.toThrow();
    expect(() =>
      validateSessionConfig({
        owner: authority,
        signer,
        sessionToken: "11111111111111111111111111111111", // valid pubkey, wrong PDA
      }),
    ).toThrow(FlashV2Error);
  });

  it("validateSessionConfig rejects a malformed signer pubkey", () => {
    expect(() =>
      validateSessionConfig({ owner: authority, signer: "not-base58!!", sessionToken: "x" }),
    ).toThrow(FlashV2Error);
  });
});
