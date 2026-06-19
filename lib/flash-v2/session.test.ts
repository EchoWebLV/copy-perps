import { describe, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  deriveSessionTokenV2,
  isSessionExpired,
  isSessionExpiringSoon,
  validateSessionConfig,
  buildCreateSessionTx,
  buildRevokeSessionTx,
  isSessionRowActive,
  signTradeWithSession,
  submitErTx,
} from "./session";
import * as rpc from "./rpc";
import { KEYSP_PROGRAM_ID } from "./constants";
import { FlashV2Error } from "./errors";

/** A connection that never hits the network: only getLatestBlockhash is used. */
function offlineConn(): Connection {
  const conn = new Connection("http://127.0.0.1:8899");
  vi.spyOn(conn, "getLatestBlockhash").mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1,
  } as never);
  return conn;
}

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

  it("isSessionRowActive requires bound + unexpired", () => {
    const now = 1_000_000;
    expect(isSessionRowActive({ boundAt: new Date(0), validUntil: new Date(now + 1000) }, now)).toBe(true);
    expect(isSessionRowActive({ boundAt: null, validUntil: new Date(now + 1000) }, now)).toBe(false);
    expect(isSessionRowActive({ boundAt: new Date(0), validUntil: new Date(now - 1) }, now)).toBe(false);
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

describe("session creation/revoke tx", () => {
  it("buildCreateSessionTx emits a Keysp createSessionV2 ix with the derived PDA + signers", async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    const sessionSigner = Keypair.generate();
    const { tx, sessionToken } = await buildCreateSessionTx({
      authority,
      sessionSigner,
      validUntilSec: 1_900_000_000,
      connection: offlineConn(),
    });
    expect(sessionToken).toBe(
      deriveSessionTokenV2(authority, sessionSigner.publicKey.toBase58()).toBase58(),
    );
    const ix = tx.instructions.find((i) => i.programId.toBase58() === KEYSP_PROGRAM_ID);
    expect(ix).toBeDefined();
    const keys = ix!.keys;
    expect(keys.some((k) => k.pubkey.toBase58() === sessionToken)).toBe(true);
    expect(keys.some((k) => k.pubkey.equals(sessionSigner.publicKey) && k.isSigner)).toBe(true);
    expect(keys.some((k) => k.pubkey.toBase58() === authority && k.isSigner)).toBe(true);
    expect(tx.feePayer?.toBase58()).toBe(authority);
    // The session signer co-signed; the user wallet's signature is still pending.
    expect(tx.signatures.some((s) => s.publicKey.equals(sessionSigner.publicKey) && s.signature)).toBe(true);
  });

  it("buildRevokeSessionTx targets Keysp revokeSessionV2", async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    const sessionSigner = Keypair.generate().publicKey.toBase58();
    const tx = await buildRevokeSessionTx({ authority, sessionSigner, connection: offlineConn() });
    expect(tx.instructions.some((i) => i.programId.toBase58() === KEYSP_PROGRAM_ID)).toBe(true);
    expect(tx.feePayer?.toBase58()).toBe(authority);
  });
});

describe("session trade signing + ER submit", () => {
  it("signTradeWithSession signs with the session keypair and returns the tx", () => {
    const session = Keypair.generate();
    const sign = vi.fn();
    const tx = { sign } as unknown as VersionedTransaction;
    const out = signTradeWithSession(tx, session.secretKey);
    expect(out).toBe(tx);
    const signers = sign.mock.calls[0]![0] as Keypair[];
    expect(signers[0]!.publicKey.equals(session.publicKey)).toBe(true);
  });

  it("submitErTx submits the serialized tx to the ER connection with skipPreflight", async () => {
    const sendRawTransaction = vi.fn().mockResolvedValue("SIG");
    const spy = vi
      .spyOn(rpc, "getConnection")
      .mockReturnValue({ sendRawTransaction } as never);
    const tx = { serialize: () => new Uint8Array([1, 2, 3]) } as unknown as VersionedTransaction;
    const sig = await submitErTx(tx);
    expect(sig).toBe("SIG");
    expect(spy).toHaveBeenCalledWith("er");
    expect(sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), { skipPreflight: true });
    spy.mockRestore();
  });
});
