import { afterEach, describe, expect, it, vi } from "vitest";

describe("getMark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.useRealTimers();
  });

  it("fetches a Pacifica mark for markets outside the warm snapshot", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const price = url.includes("symbol=MON") ? "0.0267" : undefined;
      return new Response(
        JSON.stringify({
          success: true,
          data: price ? [{ price }] : [],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMark } = await import("./marks");

    await expect(getMark("MON")).resolves.toBe(0.0267);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("symbol=MON"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("lets portfolio callers use a shorter mark cache age", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
    let btcPrice = 100;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const symbol = url.match(/symbol=([^&]+)/)?.[1] ?? "BTC";
      const price = symbol === "BTC" ? btcPrice : 1;
      return new Response(
        JSON.stringify({
          success: true,
          data: [{ price }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getMarksSnapshot } = await import("./marks");

    expect((await getMarksSnapshot({ maxAgeMs: 3000 })).get("BTC")).toBe(100);
    btcPrice = 101;
    vi.setSystemTime(new Date("2026-05-28T12:00:02.000Z"));
    expect((await getMarksSnapshot({ maxAgeMs: 3000 })).get("BTC")).toBe(100);
    vi.setSystemTime(new Date("2026-05-28T12:00:04.000Z"));
    expect((await getMarksSnapshot({ maxAgeMs: 3000 })).get("BTC")).toBe(101);
  });
});
