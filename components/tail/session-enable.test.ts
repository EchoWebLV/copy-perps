import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableFlashV2Session,
  revokeFlashV2Session,
  SessionAlreadyBoundClientError,
} from "./session-enable";

// base64("\x01\x02\x03") so b64ToBytes/atob succeeds in the helper.
const TX_B64 = "AQID";

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    getAccessToken: vi.fn(async () => "token"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: { address: "WALLET" } as any,
    signAndSendTransaction: vi.fn(async () => ({ signature: "SIG58" })),
    confirm: vi.fn(async () => {}),
    ...over,
  };
}

describe("enableFlashV2Session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds, signs, confirms on-chain, then flips bound; returns identifiers", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/users/me/session") {
        return new Response(
          JSON.stringify({
            createSessionTransaction: TX_B64,
            sessionPubkey: "SPUB",
            sessionToken: "STOK",
            validUntil: "2026-06-20T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const deps = makeDeps();
    const out = await enableFlashV2Session({ ...deps, fetchImpl: fetchImpl as never });

    expect(out).toEqual({ sessionPubkey: "SPUB", validUntil: "2026-06-20T00:00:00.000Z" });
    expect(deps.signAndSendTransaction).toHaveBeenCalledOnce();
    expect(deps.confirm).toHaveBeenCalledWith("SIG58");
    // confirm POST carries the session pubkey
    const confirmCall = fetchImpl.mock.calls.find(
      (c) => c[0] === "/api/users/me/session/confirm",
    );
    expect(confirmCall).toBeTruthy();
    expect(JSON.parse((confirmCall![1] as RequestInit).body as string)).toMatchObject({
      sessionPubkey: "SPUB",
      walletAddress: "WALLET",
    });
  });

  it("throws SessionAlreadyBoundClientError on a 409 (caller must revoke first)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: "bound", priorSessionPubkey: "PRIOR", priorSessionToken: "PT" }),
        { status: 409 },
      ),
    );
    const deps = makeDeps();
    await expect(
      enableFlashV2Session({ ...deps, fetchImpl: fetchImpl as never }),
    ).rejects.toBeInstanceOf(SessionAlreadyBoundClientError);
    expect(deps.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("throws when the server confirm fails (does not silently succeed)", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/users/me/session") {
        return new Response(
          JSON.stringify({ createSessionTransaction: TX_B64, sessionPubkey: "SPUB" }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "no pending session to confirm" }), {
        status: 404,
      });
    });
    const deps = makeDeps();
    await expect(
      enableFlashV2Session({ ...deps, fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/confirm/);
    expect(deps.confirm).toHaveBeenCalledOnce(); // got far enough to sign + chain-confirm
  });
});

describe("revokeFlashV2Session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the revoke tx, signs, confirms on-chain, then posts the confirmed delete", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const isConfirm =
        url === "/api/users/me/session/revoke" &&
        JSON.parse((init?.body as string) ?? "{}").confirmed === true;
      if (url === "/api/users/me/session/revoke" && !isConfirm) {
        return new Response(JSON.stringify({ revokeTransaction: TX_B64 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const deps = makeDeps();
    await revokeFlashV2Session({ ...deps, fetchImpl: fetchImpl as never });

    expect(deps.signAndSendTransaction).toHaveBeenCalledOnce();
    expect(deps.confirm).toHaveBeenCalledWith("SIG58");
    const confirmCall = fetchImpl.mock.calls.find(
      (c) => JSON.parse((c[1] as RequestInit).body as string).confirmed === true,
    );
    expect(confirmCall).toBeTruthy();
  });

  it("throws (and never signs) when the build returns no tx", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "no bound session to revoke" }), { status: 404 }),
    );
    const deps = makeDeps();
    await expect(
      revokeFlashV2Session({ ...deps, fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/revoke/);
    expect(deps.signAndSendTransaction).not.toHaveBeenCalled();
  });
});
