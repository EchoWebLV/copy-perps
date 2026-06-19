import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class SessionAlreadyBoundError extends Error {
    constructor(
      public priorSessionPubkey: string,
      public priorSessionTokenPda: string,
    ) {
      super("bound");
    }
  }
  return {
    verifyPrivyRequest: vi.fn(),
    ensureUser: vi.fn(),
    getConnection: vi.fn(() => ({})),
    buildCreateSessionTx: vi.fn(),
    buildRevokeSessionTx: vi.fn(),
    SessionAlreadyBoundError,
    generateSessionKeypair: vi.fn(),
    createPendingSessionKey: vi.fn(),
    markSessionKeyBound: vi.fn(),
    getSessionStatus: vi.fn(),
    deleteSessionKey: vi.fn(),
  };
});

vi.mock("@/lib/privy/server", () => ({ verifyPrivyRequest: mocks.verifyPrivyRequest }));
vi.mock("@/lib/users/ensure", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/flash-v2/constants", () => ({
  FEATURE_FLASH_V2: true,
  DEFAULT_SESSION_TTL_SECONDS: 43200,
  MAX_SESSION_TTL_SECONDS: 7 * 24 * 60 * 60,
}));
vi.mock("@/lib/flash-v2/rpc", () => ({ getConnection: mocks.getConnection }));
vi.mock("@/lib/flash-v2/session", () => ({
  buildCreateSessionTx: mocks.buildCreateSessionTx,
  buildRevokeSessionTx: mocks.buildRevokeSessionTx,
  SessionAlreadyBoundError: mocks.SessionAlreadyBoundError,
}));
vi.mock("@/lib/flash-v2/session-store", () => ({
  generateSessionKeypair: mocks.generateSessionKeypair,
  createPendingSessionKey: mocks.createPendingSessionKey,
  markSessionKeyBound: mocks.markSessionKeyBound,
  getSessionStatus: mocks.getSessionStatus,
  deleteSessionKey: mocks.deleteSessionKey,
}));

import {
  POST as buildPost,
  GET as statusGet,
} from "../../app/api/users/me/session/route";
import { POST as confirmPost } from "../../app/api/users/me/session/confirm/route";
import { POST as revokePost } from "../../app/api/users/me/session/revoke/route";

function post(body: object) {
  return new Request("http://local.test/api/users/me/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function get() {
  return new Request("http://local.test/api/users/me/session", {
    method: "GET",
    headers: { authorization: "Bearer t" },
  });
}

describe("Flash v2 session enable routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({
      id: "user-1",
      solanaPubkey: "AW3jPeBDkyRWB3mSV6QmbWyBZqyeVNhCHWCuefMrdQGr",
    });
    mocks.generateSessionKeypair.mockReturnValue({
      publicKeyB58: "SESSIONPUB",
      seed: new Uint8Array(32),
    });
    mocks.buildCreateSessionTx.mockResolvedValue({
      tx: { serialize: () => Buffer.from([1, 2, 3]) },
      sessionToken: "TOKEN",
    });
    mocks.createPendingSessionKey.mockResolvedValue(undefined);
    mocks.markSessionKeyBound.mockResolvedValue(true);
  });

  it("build: returns the createSession tx + session identifiers and persists pending", async () => {
    const res = await buildPost(post({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sessionPubkey: "SESSIONPUB", sessionToken: "TOKEN" });
    expect(body.createSessionTransaction).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(typeof body.validUntil).toBe("string");
    expect(mocks.createPendingSessionKey).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionPubkey: "SESSIONPUB",
        sessionTokenPda: "TOKEN",
      }),
    );
  });

  it("build: 409 when a bound session already exists", async () => {
    mocks.createPendingSessionKey.mockRejectedValue(
      new mocks.SessionAlreadyBoundError("PRIOR", "PRIORTOKEN"),
    );
    const res = await buildPost(post({}));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.priorSessionPubkey).toBe("PRIOR");
  });

  it("confirm: binds the session and returns ok", async () => {
    const res = await confirmPost(post({ sessionPubkey: "SESSIONPUB" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.markSessionKeyBound).toHaveBeenCalledWith("user-1", "SESSIONPUB");
  });

  it("confirm: 404 when there is no pending session", async () => {
    mocks.markSessionKeyBound.mockResolvedValue(false);
    const res = await confirmPost(post({ sessionPubkey: "SESSIONPUB" }));
    expect(res.status).toBe(404);
  });

  it("confirm: 400 without a sessionPubkey", async () => {
    const res = await confirmPost(post({}));
    expect(res.status).toBe(400);
  });

  it("status: returns the classified state + validUntil", async () => {
    const until = new Date(Date.now() + 3_600_000);
    mocks.getSessionStatus.mockResolvedValue({
      state: "active",
      sessionPubkey: "SESSIONPUB",
      validUntil: until,
    });
    const res = await statusGet(get());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      state: "active",
      sessionPubkey: "SESSIONPUB",
      validUntil: until.toISOString(),
    });
  });

  it("status: 'none' (no row) returns nulls", async () => {
    mocks.getSessionStatus.mockResolvedValue({
      state: "none",
      sessionPubkey: null,
      validUntil: null,
    });
    const res = await statusGet(get());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      state: "none",
      sessionPubkey: null,
      validUntil: null,
    });
  });

  it("revoke build: returns the revoke tx for a bound (active) session", async () => {
    mocks.getSessionStatus.mockResolvedValue({
      state: "active",
      sessionPubkey: "SESSIONPUB",
      validUntil: new Date(Date.now() + 3_600_000),
    });
    mocks.buildRevokeSessionTx.mockResolvedValue({
      serialize: () => Buffer.from([4, 5, 6]),
    });
    const res = await revokePost(post({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revokeTransaction).toBe(Buffer.from([4, 5, 6]).toString("base64"));
    expect(body.sessionPubkey).toBe("SESSIONPUB");
    expect(mocks.deleteSessionKey).not.toHaveBeenCalled();
  });

  it("revoke build: 404 when there is no bound session", async () => {
    mocks.getSessionStatus.mockResolvedValue({
      state: "none",
      sessionPubkey: null,
      validUntil: null,
    });
    const res = await revokePost(post({}));
    expect(res.status).toBe(404);
    expect(mocks.buildRevokeSessionTx).not.toHaveBeenCalled();
  });

  it("revoke confirm: drops the row and returns ok", async () => {
    const res = await revokePost(post({ confirmed: true }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteSessionKey).toHaveBeenCalledWith("user-1");
    expect(mocks.buildRevokeSessionTx).not.toHaveBeenCalled();
  });
});
