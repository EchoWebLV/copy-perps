import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("autopilot ticker production controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    delete (
      globalThis as typeof globalThis & { __autopilotTickerStarted?: boolean }
    ).__autopilotTickerStarted;
  });

  it("can be disabled via DISABLE_AUTOPILOT_TICKER", async () => {
    vi.stubEnv("DISABLE_AUTOPILOT_TICKER", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { startAutopilotTicker } = await import("@/lib/autopilot/ticker");
    startAutopilotTicker();

    expect(
      (
        globalThis as typeof globalThis & {
          __autopilotTickerStarted?: boolean;
        }
      ).__autopilotTickerStarted,
    ).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      "[autopilot] ticker disabled via DISABLE_AUTOPILOT_TICKER",
    );
  });

  it("defaults to a one minute tick gap", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/autopilot/ticker.ts"),
      "utf8",
    );
    expect(source).toContain("process.env.AUTOPILOT_TICK_GAP_MS ?? 60_000");
  });

  it("uses its own lease table, not the whale one", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/autopilot/ticker-lease.ts"),
      "utf8",
    );
    expect(source).toContain("autopilot_ticker_lease");
    expect(source).not.toContain("whale_ticker_lease");
  });

  it("is booted from instrumentation.ts", () => {
    const source = readFileSync(
      join(process.cwd(), "instrumentation.ts"),
      "utf8",
    );
    expect(source).toContain("startAutopilotTicker");
  });
});
