import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("whale ticker production controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __whaleTickerStarted?: boolean })
      .__whaleTickerStarted;
  });

  it("can be disabled when refresh work is moved out of the web process", async () => {
    vi.stubEnv("DISABLE_WHALE_TICKER", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { startWhaleTicker } = await import("@/lib/whales/ticker");
    startWhaleTicker();

    expect(
      (globalThis as typeof globalThis & { __whaleTickerStarted?: boolean })
        .__whaleTickerStarted,
    ).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      "[whales] ticker disabled via DISABLE_WHALE_TICKER",
    );
  });

  it("defaults to a one minute refresh gap so background work does not crowd requests", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/whales/ticker.ts"),
      "utf8",
    );

    expect(source).toContain("process.env.WHALE_REFRESH_GAP_MS ?? 60_000");
  });
});
