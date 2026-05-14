import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { getCandles, type Candle } from "./candles";

describe("getCandles", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed candles in chronological order (oldest first)", async () => {
    const mockBody = [
      { t: 1000, T: 1060, o: "100", h: "102", l: "99", c: "101", v: "5.5", n: 10, i: "1m", s: "SOL" },
      { t: 1060, T: 1120, o: "101", h: "103", l: "100", c: "102", v: "6.2", n: 12, i: "1m", s: "SOL" },
    ];
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockBody), { status: 200 }),
    );

    const candles = await getCandles("SOL", "1m", 2);
    expect(candles).toHaveLength(2);
    expect(candles[0].ts).toBe(1000);
    expect(candles[0].open).toBeCloseTo(100);
    expect(candles[0].high).toBeCloseTo(102);
    expect(candles[0].low).toBeCloseTo(99);
    expect(candles[0].close).toBeCloseTo(101);
    expect(candles[0].volume).toBeCloseTo(5.5);
    expect(candles[1].close).toBeCloseTo(102);
  });

  it("caches the result for the configured TTL", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ t: 1000, T: 1060, o: "100", h: "100", l: "100", c: "100", v: "1", n: 1, i: "1m", s: "SOL" }]), { status: 200 }),
    );
    await getCandles("SOL", "1m", 1);
    await getCandles("SOL", "1m", 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns empty array (not throws) when fetch fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("upstream error", { status: 500 }),
    );
    const candles = await getCandles("BNB", "1m", 5);
    expect(candles).toEqual([]);
  });

  it("requests count candles by computing startTime from interval", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await getCandles("XRP", "5m", 12);
    const call = fetchSpy.mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.type).toBe("candleSnapshot");
    expect(body.req.coin).toBe("XRP");
    expect(body.req.interval).toBe("5m");
    const windowMs = body.req.endTime - body.req.startTime;
    expect(windowMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(windowMs).toBeLessThanOrEqual(70 * 60 * 1000);
  });
});
