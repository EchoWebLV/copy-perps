import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  whaleSocialEnabled: vi.fn(),
  buildWhalePositionSignals: vi.fn(),
  buildWhaleTraderSignals: vi.fn(),
  buildCachedWhaleTraderSignals: vi.fn(),
}));

vi.mock("@/lib/features", () => ({
  whaleSocialEnabled: mocks.whaleSocialEnabled,
}));

vi.mock("@/lib/signals/whale-signals", () => ({
  buildWhalePositionSignals: mocks.buildWhalePositionSignals,
  buildWhaleTraderSignals: mocks.buildWhaleTraderSignals,
  buildCachedWhaleTraderSignals: mocks.buildCachedWhaleTraderSignals,
}));

describe("whale API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.whaleSocialEnabled.mockReturnValue(true);
    mocks.buildWhalePositionSignals.mockResolvedValue([]);
    mocks.buildWhaleTraderSignals.mockResolvedValue([]);
    mocks.buildCachedWhaleTraderSignals.mockResolvedValue([]);
  });

  it("returns 404 from roster when whale social is disabled", async () => {
    mocks.whaleSocialEnabled.mockReturnValue(false);
    const { GET } = await import("@/app/api/whales/roster/route");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(mocks.buildCachedWhaleTraderSignals).not.toHaveBeenCalled();
  });

  it("returns roster signals when whale social is enabled", async () => {
    const whale = {
      id: "whale_trader:one",
      heatScore: 10,
      payload: {
        openPositions: [],
        stats: { pnlCurve: [] },
      },
    };
    mocks.buildCachedWhaleTraderSignals.mockResolvedValue([whale]);
    const { GET } = await import("@/app/api/whales/roster/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ whales: [whale] });
    expect(mocks.buildCachedWhaleTraderSignals).toHaveBeenCalledTimes(1);
  });

  it("trims roster payloads before sending them to the client", async () => {
    const whale = {
      id: "whale_trader:heavy",
      heatScore: 100,
      payload: {
        openPositions: Array.from({ length: 8 }, (_, idx) => ({
          positionId: `position-${idx}`,
        })),
        stats: {
          pnlCurve: Array.from({ length: 140 }, (_, idx) => ({
            t: idx,
            v: idx,
          })),
        },
      },
    };
    mocks.buildCachedWhaleTraderSignals.mockResolvedValue([whale]);
    const { GET } = await import("@/app/api/whales/roster/route");

    const response = await GET();
    const body = await response.json();

    expect(body.whales[0].payload.openPositions).toHaveLength(3);
    expect(body.whales[0].payload.stats.pnlCurve).toHaveLength(96);
    expect(body.whales[0].payload.stats.pnlCurve.at(0)).toEqual({
      t: 0,
      v: 0,
    });
    expect(body.whales[0].payload.stats.pnlCurve.at(-1)).toEqual({
      t: 139,
      v: 139,
    });
  });

  it("returns 404 from live positions when whale social is disabled", async () => {
    mocks.whaleSocialEnabled.mockReturnValue(false);
    const { GET } = await import("@/app/api/whales/live/route");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(mocks.buildWhalePositionSignals).not.toHaveBeenCalled();
  });

  it("returns sorted live positions when whale social is enabled", async () => {
    mocks.buildWhalePositionSignals.mockResolvedValue([
      { id: "cold", heatScore: 10 },
      { id: "hot", heatScore: 20 },
    ]);
    const { GET } = await import("@/app/api/whales/live/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      positions: [
        { id: "hot", heatScore: 20 },
        { id: "cold", heatScore: 10 },
      ],
    });
  });

  it("passes an explicit live positions limit from the request query", async () => {
    mocks.buildWhalePositionSignals.mockResolvedValue([]);
    const { GET } = await import("@/app/api/whales/live/route");

    await GET(new Request("http://localhost/api/whales/live?limit=1000"));

    expect(mocks.buildWhalePositionSignals).toHaveBeenCalledWith(1000, {
      includeNonCopyable: true,
    });
  });
});
