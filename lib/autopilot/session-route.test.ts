import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  getActiveSession: vi.fn(),
  sessionStats: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));
vi.mock("@/lib/autopilot/sessions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/autopilot/sessions")>();
  return {
    ...actual, // keep AutopilotSessionError + budget consts real
    startSession: mocks.startSession,
    stopSession: mocks.stopSession,
    getActiveSession: mocks.getActiveSession,
    sessionStats: mocks.sessionStats,
  };
});

import { AutopilotSessionError } from "@/lib/autopilot/sessions";
import {
  DELETE,
  GET,
  POST,
} from "../../app/api/autopilot/session/route";

const SESSION = {
  id: "sess-1",
  userId: "user-1",
  budgetUsd: 100,
  tier: "cruise",
  status: "active",
  realizedPnlUsd: 0,
  startedAt: new Date("2026-06-11T12:00:00Z"),
  endedAt: null,
  lastTickAt: null,
};

function request(method: string, body?: unknown) {
  return new Request("http://local.test/api/autopilot/session", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("autopilot session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY", "test-key");
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-1" });
    mocks.ensureUser.mockResolvedValue({
      id: "user-1",
      solanaPubkey: "wallet-1",
    });
    mocks.startSession.mockResolvedValue(SESSION);
    mocks.getActiveSession.mockResolvedValue(SESSION);
    mocks.stopSession.mockResolvedValue({ ...SESSION, status: "stopped" });
    mocks.sessionStats.mockResolvedValue({
      realizedPnlUsd: 0,
      closedCount: 0,
      openBets: [],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("401s without auth", async () => {
    mocks.verifyPrivyRequest.mockResolvedValue(null);
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(401);
  });

  it("503s when the server cannot instant-sign", async () => {
    vi.stubEnv("PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY", "");
    vi.stubEnv("PRIVY_AUTHORIZATION_PRIVATE_KEY", "");
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(503);
  });

  it("POST validates body shape", async () => {
    expect(
      (await POST(request("POST", { tier: "cruise", walletAddress: "w" })))
        .status,
    ).toBe(400);
    expect(
      (
        await POST(
          request("POST", { budgetUsd: 50, tier: "yolo", walletAddress: "w" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(request("POST", { budgetUsd: 50, tier: "cruise" }))).status,
    ).toBe(400);
  });

  it("POST starts a session", async () => {
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("sess-1");
    expect(mocks.startSession).toHaveBeenCalledWith({
      userId: "user-1",
      budgetUsd: 50,
      tier: "cruise",
    });
  });

  it("POST maps active-session-exists to 409", async () => {
    mocks.startSession.mockRejectedValue(
      new AutopilotSessionError("active-session-exists"),
    );
    const res = await POST(
      request("POST", { budgetUsd: 50, tier: "cruise", walletAddress: "w" }),
    );
    expect(res.status).toBe(409);
  });

  it("GET returns the active session with stats", async () => {
    const res = await GET(request("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe("sess-1");
    expect(body.stats.closedCount).toBe(0);
  });

  it("GET returns null when no session is active", async () => {
    mocks.getActiveSession.mockResolvedValue(null);
    const res = await GET(request("GET"));
    const body = await res.json();
    expect(body.session).toBeNull();
    expect(body.stats).toBeNull();
  });

  it("DELETE stops and documents the keep-positions-open choice", async () => {
    const res = await DELETE(request("DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.status).toBe("stopped");
    expect(body.message).toMatch(/positions stay open/i);
  });

  it("DELETE 404s with nothing to stop", async () => {
    mocks.getActiveSession.mockResolvedValue(null);
    const res = await DELETE(request("DELETE"));
    expect(res.status).toBe(404);
  });
});
