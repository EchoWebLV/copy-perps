// lib/notifications/push.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { notificationUrlForKind } from "./push";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // web-push mock
  const webpush = {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  };

  // db mock with chainable builder
  const deleteChain = {
    where: vi.fn(),
  };
  deleteChain.where.mockResolvedValue(undefined);

  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockResolvedValue([]);

  return { webpush, deleteChain, selectChain };
});

vi.mock("web-push", () => ({ default: mocks.webpush }));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => mocks.selectChain),
    delete: vi.fn(() => mocks.deleteChain),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  pushSubscriptions: {
    userId: "user_id",
    endpoint: "endpoint",
    p256dh: "p256dh",
    auth: "auth",
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────────────
import { sendPushToUser } from "./push";
import type webpush from "web-push";

// ── notificationUrlForKind ────────────────────────────────────────────────────

describe("notificationUrlForKind", () => {
  it("maps copy-opened to /portfolio", () => {
    expect(notificationUrlForKind("copy-opened")).toBe("/portfolio");
  });
  it("maps copy-closed to /portfolio", () => {
    expect(notificationUrlForKind("copy-closed")).toBe("/portfolio");
  });
  it("maps auto-close to /portfolio", () => {
    expect(notificationUrlForKind("auto-close")).toBe("/portfolio");
  });
  it("maps source-closed to /portfolio", () => {
    expect(notificationUrlForKind("source-closed")).toBe("/portfolio");
  });
  it("maps autopilot-ended to /portfolio", () => {
    expect(notificationUrlForKind("autopilot-ended")).toBe("/portfolio");
  });
  it("returns /portfolio for unknown kinds", () => {
    expect(notificationUrlForKind("unknown-event-xyz")).toBe("/portfolio");
  });
});

// ── sendPushToUser ────────────────────────────────────────────────────────────

// Helper: configure a fake process.env so ensureConfigured() succeeds
function setVapidEnv() {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BCfakePublicKey";
  process.env.VAPID_PRIVATE_KEY = "fakePrivateKey";
  process.env.VAPID_SUBJECT = "mailto:test@gwak.gg";
}

const FAKE_SUB = {
  id: "sub-uuid",
  userId: "user-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/test-endpoint",
  p256dh: "dGVzdC1wMjU2ZGg=",
  auth: "dGVzdC1hdXRo",
  createdAt: new Date(),
};

describe("sendPushToUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setVapidEnv();
    // Reset chains
    mocks.selectChain.from.mockReturnValue(mocks.selectChain);
    mocks.selectChain.where.mockResolvedValue([]);
    mocks.deleteChain.where.mockResolvedValue(undefined);
  });

  it("is a no-op when user has no subscriptions", async () => {
    mocks.selectChain.where.mockResolvedValueOnce([]);
    await sendPushToUser("user-1", { title: "Test", body: "Hello" });
    expect(mocks.webpush.sendNotification).not.toHaveBeenCalled();
  });

  it("calls sendNotification with correct subscription and JSON payload", async () => {
    mocks.selectChain.where.mockResolvedValueOnce([FAKE_SUB]);
    mocks.webpush.sendNotification.mockResolvedValueOnce({
      statusCode: 201,
      body: "",
      headers: {},
    });

    await sendPushToUser("user-1", {
      title: "Copy opened",
      body: "Iron Wolf entered BTC",
      url: "/portfolio",
    });

    expect(mocks.webpush.sendNotification).toHaveBeenCalledTimes(1);
    const [sub, payloadStr] = mocks.webpush.sendNotification.mock.calls[0] as [
      unknown,
      string,
    ];
    expect(sub).toMatchObject({
      endpoint: FAKE_SUB.endpoint,
      keys: { p256dh: FAKE_SUB.p256dh, auth: FAKE_SUB.auth },
    });
    const payload = JSON.parse(payloadStr);
    expect(payload).toMatchObject({ title: "Copy opened", body: "Iron Wolf entered BTC", url: "/portfolio" });
  });

  it("prunes a 410 (Gone) endpoint and does not rethrow", async () => {
    mocks.selectChain.where.mockResolvedValueOnce([FAKE_SUB]);
    const goneErr = Object.assign(new Error("Gone"), { statusCode: 410 });
    mocks.webpush.sendNotification.mockRejectedValueOnce(goneErr);

    // Should not throw
    await expect(
      sendPushToUser("user-1", { title: "T", body: "B" }),
    ).resolves.toBeUndefined();

    // delete was called with the dead endpoint
    const { db } = await import("@/lib/db");
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
    expect(mocks.deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it("prunes a 404 endpoint too", async () => {
    mocks.selectChain.where.mockResolvedValueOnce([FAKE_SUB]);
    const notFoundErr = Object.assign(new Error("Not Found"), { statusCode: 404 });
    mocks.webpush.sendNotification.mockRejectedValueOnce(notFoundErr);

    await expect(
      sendPushToUser("user-1", { title: "T", body: "B" }),
    ).resolves.toBeUndefined();

    const { db } = await import("@/lib/db");
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
  });

  it("does NOT prune on non-gone errors (e.g. 500), but still does not throw", async () => {
    mocks.selectChain.where.mockResolvedValueOnce([FAKE_SUB]);
    const serverErr = Object.assign(new Error("Server Error"), { statusCode: 500 });
    mocks.webpush.sendNotification.mockRejectedValueOnce(serverErr);

    await expect(
      sendPushToUser("user-1", { title: "T", body: "B" }),
    ).resolves.toBeUndefined();

    const { db } = await import("@/lib/db");
    expect(vi.mocked(db.delete)).not.toHaveBeenCalled();
  });

  it("sends to all endpoints and prunes only the dead one when mixed results", async () => {
    const goodSub = { ...FAKE_SUB, endpoint: "https://good.endpoint/1", id: "sub-good" };
    const deadSub = { ...FAKE_SUB, endpoint: "https://dead.endpoint/2", id: "sub-dead" };
    mocks.selectChain.where.mockResolvedValueOnce([goodSub, deadSub]);

    mocks.webpush.sendNotification
      .mockResolvedValueOnce({ statusCode: 201, body: "", headers: {} })
      .mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));

    await sendPushToUser("user-1", { title: "T", body: "B" });

    expect(mocks.webpush.sendNotification).toHaveBeenCalledTimes(2);
    const { db } = await import("@/lib/db");
    // Only one delete (the dead one)
    expect(vi.mocked(db.delete)).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the entire function errors internally", async () => {
    mocks.selectChain.from.mockImplementationOnce(() => {
      throw new Error("DB exploded");
    });
    await expect(
      sendPushToUser("user-1", { title: "T", body: "B" }),
    ).resolves.toBeUndefined();
  });
});
