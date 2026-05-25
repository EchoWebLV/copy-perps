import { afterEach, describe, expect, it, vi } from "vitest";

describe("getMark", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
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
});
