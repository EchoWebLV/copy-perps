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
    const whale = { id: "whale_trader:one" };
    mocks.buildCachedWhaleTraderSignals.mockResolvedValue([whale]);
    const { GET } = await import("@/app/api/whales/roster/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ whales: [whale] });
    expect(mocks.buildCachedWhaleTraderSignals).toHaveBeenCalledTimes(1);
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
});
