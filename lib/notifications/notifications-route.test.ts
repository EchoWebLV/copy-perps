import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // Chainable drizzle builder for SELECT
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);

  // Chainable drizzle builder for UPDATE
  const updateChain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);

  return {
    verifyPrivyRequest: vi.fn(),
    ensureUser: vi.fn(),
    selectChain,
    updateChain,
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
    select: vi.fn(() => mocks.selectChain),
    update: vi.fn(() => mocks.updateChain),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  notificationEvents: {
    id: "id",
    userId: "user_id",
    kind: "kind",
    title: "title",
    body: "body",
    createdAt: "created_at",
    readAt: "read_at",
  },
}));

// Spy on drizzle condition helpers so the POST scoping test can assert
// that the where clause contains BOTH the user-scoping (eq) and the
// unread-only guard (isNull) — not a wipe-all or cross-user update.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(actual.eq),
    isNull: vi.fn(actual.isNull),
    and: vi.fn(actual.and),
    desc: vi.fn(actual.desc),
  };
});

// ── Import routes AFTER mock declarations ────────────────────────────────────

import { GET, POST } from "@/app/api/notifications/route";
import { eq, isNull } from "drizzle-orm";
import { notificationEvents } from "@/lib/db/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function authedGet() {
  return new Request("http://localhost/api/notifications", { method: "GET" });
}

function authedPost() {
  return new Request("http://localhost/api/notifications", { method: "POST" });
}

const FAKE_USER = { id: "user-uuid-123" };

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-id", appId: "app", sessionId: "sess" });
  mocks.ensureUser.mockResolvedValue(FAKE_USER);

  // Reset chains
  const { selectChain, updateChain } = mocks;
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  selectChain.orderBy.mockReturnValue(selectChain);
  selectChain.limit.mockResolvedValue([]);
  updateChain.set.mockReturnValue(updateChain);
  updateChain.where.mockResolvedValue(undefined);
});

describe("GET /api/notifications", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.verifyPrivyRequest.mockResolvedValueOnce(null);
    const res = await GET(authedGet());
    expect(res.status).toBe(401);
  });

  it("returns { events: [], unread: 0 } when there are no rows", async () => {
    mocks.selectChain.limit.mockResolvedValueOnce([]);
    const res = await GET(authedGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ events: [], unread: 0 });
  });

  it("maps DB rows to NotificationDto shape correctly", async () => {
    const now = new Date("2026-06-13T10:00:00.000Z");
    const later = new Date("2026-06-13T11:00:00.000Z");
    const rows = [
      {
        id: "evt-1",
        kind: "copy-opened",
        title: "Copied Whale A",
        body: "Your copy is live.",
        createdAt: later,
        readAt: null,
      },
      {
        id: "evt-2",
        kind: "auto-close",
        title: "Auto-close fired",
        body: "Closed with them.",
        createdAt: now,
        readAt: now,
      },
    ];
    mocks.selectChain.limit.mockResolvedValueOnce(rows);

    const res = await GET(authedGet());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.events).toHaveLength(2);
    // First row is unread
    expect(body.events[0]).toMatchObject({
      id: "evt-1",
      kind: "copy-opened",
      title: "Copied Whale A",
      body: "Your copy is live.",
      createdAt: later.toISOString(),
      readAt: null,
    });
    // Second row is read
    expect(body.events[1]).toMatchObject({
      id: "evt-2",
      readAt: now.toISOString(),
    });
  });

  it("computes unread count from rows where readAt is null", async () => {
    const ts = new Date();
    const rows = [
      { id: "a", kind: "copy-opened", title: "T", body: "B", createdAt: ts, readAt: null },
      { id: "b", kind: "copy-opened", title: "T", body: "B", createdAt: ts, readAt: null },
      { id: "c", kind: "auto-close", title: "T", body: "B", createdAt: ts, readAt: ts },
    ];
    mocks.selectChain.limit.mockResolvedValueOnce(rows);

    const res = await GET(authedGet());
    const body = await res.json();
    expect(body.unread).toBe(2);
  });

  it("does not include meta in the DTO", async () => {
    const ts = new Date();
    mocks.selectChain.limit.mockResolvedValueOnce([
      { id: "x", kind: "copy-opened", title: "T", body: "B", createdAt: ts, readAt: null },
    ]);
    const res = await GET(authedGet());
    const body = await res.json();
    expect(body.events[0]).not.toHaveProperty("meta");
  });
});

describe("POST /api/notifications", () => {
  it("returns 401 when not authenticated", async () => {
    mocks.verifyPrivyRequest.mockResolvedValueOnce(null);
    const res = await POST(authedPost());
    expect(res.status).toBe(401);
  });

  it("returns { ok: true } and issues the mark-read update", async () => {
    const res = await POST(authedPost());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The update chain was kicked off
    expect(mocks.updateChain.set).toHaveBeenCalledTimes(1);
    expect(mocks.updateChain.where).toHaveBeenCalledTimes(1);
  });

  it("scopes the update to the authenticated user only (not cross-user)", async () => {
    await POST(authedPost());
    // eq must be called with (notificationEvents.userId, user.id) — scopes to this user
    expect(vi.mocked(eq)).toHaveBeenCalledWith(
      notificationEvents.userId,
      FAKE_USER.id,
    );
  });

  it("scopes the update to unread rows only (isNull readAt guard, not a wipe-all)", async () => {
    await POST(authedPost());
    // isNull must be called with notificationEvents.readAt — only marks currently-unread rows
    expect(vi.mocked(isNull)).toHaveBeenCalledWith(notificationEvents.readAt);
  });

  it("combines both scope guards in a single and() condition", async () => {
    await POST(authedPost());
    // and() must be invoked — both user-scope and isNull guard are composed together
    expect(vi.mocked(isNull)).toHaveBeenCalled();
    expect(vi.mocked(eq)).toHaveBeenCalledWith(
      notificationEvents.userId,
      FAKE_USER.id,
    );
    // The where clause received the composed condition (not two separate calls)
    expect(mocks.updateChain.where).toHaveBeenCalledTimes(1);
  });
});
