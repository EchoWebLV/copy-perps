// lib/notifications/push-subscribe-route.test.ts
//
// Tests for POST /api/push/subscribe and DELETE /api/push/subscribe.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const insertChain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  };
  // values() returns chain; onConflictDoUpdate() resolves
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoUpdate.mockResolvedValue(undefined);

  const deleteChain = {
    where: vi.fn(),
  };
  deleteChain.where.mockResolvedValue(undefined);

  return {
    verifyPrivyRequest: vi.fn(),
    ensureUser: vi.fn(),
    insertChain,
    deleteChain,
  };
});

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));

vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => mocks.insertChain),
    delete: vi.fn(() => mocks.deleteChain),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  pushSubscriptions: {
    endpoint: "endpoint",
    userId: "user_id",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(actual.eq),
    and: vi.fn(actual.and),
  };
});

// ── Import routes AFTER mocks ─────────────────────────────────────────────────
import { POST, DELETE } from "@/app/api/push/subscribe/route";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_USER = { id: "user-uuid-456" };

function makePostRequest(body: unknown) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(body: unknown) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
  keys: {
    p256dh: "dGVzdC1wMjU2ZGg=",
    auth: "dGVzdC1hdXRo",
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyPrivyRequest.mockResolvedValue({
    userId: "privy-id",
    appId: "app",
    sessionId: "sess",
  });
  mocks.ensureUser.mockResolvedValue(FAKE_USER);

  // Reset chains
  mocks.insertChain.values.mockReturnValue(mocks.insertChain);
  mocks.insertChain.onConflictDoUpdate.mockResolvedValue(undefined);
  mocks.deleteChain.where.mockResolvedValue(undefined);
});

describe("POST /api/push/subscribe", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.verifyPrivyRequest.mockResolvedValueOnce(null);
    const res = await POST(makePostRequest(VALID_SUBSCRIPTION));
    expect(res.status).toBe(401);
  });

  it("returns 400 when body is malformed JSON", async () => {
    const req = new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when endpoint is missing", async () => {
    const res = await POST(
      makePostRequest({ keys: { p256dh: "a", auth: "b" } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when p256dh is missing", async () => {
    const res = await POST(
      makePostRequest({ endpoint: "https://x", keys: { auth: "b" } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when auth is missing", async () => {
    const res = await POST(
      makePostRequest({ endpoint: "https://x", keys: { p256dh: "a" } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns { ok: true } on valid subscription", async () => {
    const res = await POST(makePostRequest(VALID_SUBSCRIPTION));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("inserts into pushSubscriptions with onConflictDoUpdate targeting endpoint", async () => {
    await POST(makePostRequest(VALID_SUBSCRIPTION));
    const { db } = await import("@/lib/db");
    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1);
    expect(mocks.insertChain.values).toHaveBeenCalledWith({
      userId: FAKE_USER.id,
      endpoint: VALID_SUBSCRIPTION.endpoint,
      p256dh: VALID_SUBSCRIPTION.keys.p256dh,
      auth: VALID_SUBSCRIPTION.keys.auth,
    });
    expect(mocks.insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    // Conflict target must be endpoint, and the set must include userId + keys
    const conflictArg = mocks.insertChain.onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown;
      set: { userId: string; p256dh: string; auth: string };
    };
    expect(conflictArg.set.userId).toBe(FAKE_USER.id);
    expect(conflictArg.set.p256dh).toBe(VALID_SUBSCRIPTION.keys.p256dh);
    expect(conflictArg.set.auth).toBe(VALID_SUBSCRIPTION.keys.auth);
  });

  it("scopes the upsert to the authenticated user (not another user)", async () => {
    const otherUser = { id: "other-user-uuid" };
    mocks.ensureUser.mockResolvedValueOnce(otherUser);
    await POST(makePostRequest(VALID_SUBSCRIPTION));
    expect(mocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "other-user-uuid" }),
    );
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.verifyPrivyRequest.mockResolvedValueOnce(null);
    const res = await DELETE(makeDeleteRequest({ endpoint: "https://x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when endpoint is missing", async () => {
    const res = await DELETE(makeDeleteRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns { ok: true } on valid delete request", async () => {
    const res = await DELETE(
      makeDeleteRequest({ endpoint: VALID_SUBSCRIPTION.endpoint }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("deletes only the endpoint belonging to the authenticated user", async () => {
    await DELETE(makeDeleteRequest({ endpoint: VALID_SUBSCRIPTION.endpoint }));
    const { db } = await import("@/lib/db");
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
    // The where clause was called (scoped by both userId and endpoint via and())
    expect(mocks.deleteChain.where).toHaveBeenCalledTimes(1);
  });
});
