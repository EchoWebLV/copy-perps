import { beforeAll, describe, expect, it } from "vitest";
import { encryptSeed, decryptSeed } from "./agent";

// A throwaway 32-byte master key for the cipher (the real one is an env secret).
beforeAll(() => {
  process.env.AGENT_WALLET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const seed = new Uint8Array(32).fill(3);
const SESSION_AAD = "flash-v2-session";

describe("encryptSeed / decryptSeed domain separation", () => {
  it("round-trips with no AAD (agent-wallet custody, backward-compatible)", () => {
    expect(decryptSeed(encryptSeed(seed))).toEqual(seed);
  });

  it("round-trips under a matching AAD domain (session custody)", () => {
    expect(decryptSeed(encryptSeed(seed, SESSION_AAD), SESSION_AAD)).toEqual(seed);
  });

  it("refuses a session ciphertext decrypted as an agent-wallet seed (no AAD)", () => {
    const enc = encryptSeed(seed, SESSION_AAD);
    expect(() => decryptSeed(enc)).toThrow();
  });

  it("refuses an agent-wallet ciphertext decrypted under the session domain", () => {
    const enc = encryptSeed(seed); // no AAD
    expect(() => decryptSeed(enc, SESSION_AAD)).toThrow();
  });

  it("refuses a session ciphertext decrypted under a different domain", () => {
    const enc = encryptSeed(seed, SESSION_AAD);
    expect(() => decryptSeed(enc, "some-other-domain")).toThrow();
  });
});
