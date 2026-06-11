import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("arena crank production controls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __arenaCrankStarted?: boolean })
      .__arenaCrankStarted;
  });

  it("can be disabled via DISABLE_ARENA_CRANK", async () => {
    vi.stubEnv("DISABLE_ARENA_CRANK", "true");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { startArenaCrank } = await import("@/lib/arena/crank");
    startArenaCrank();

    expect(
      (globalThis as typeof globalThis & { __arenaCrankStarted?: boolean })
        .__arenaCrankStarted,
    ).toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(
      "[arena] crank disabled via DISABLE_ARENA_CRANK",
    );
  });

  it("uses its own lease table, not the autopilot one", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/arena/lease.ts"),
      "utf8",
    );
    expect(source).toContain("arena_crank_lease");
    expect(source).not.toContain("autopilot_ticker_lease");
  });

  it("defaults to a two second tick gap", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/arena/crank.ts"),
      "utf8",
    );
    expect(source).toContain("process.env.ARENA_CRANK_INTERVAL_MS ?? 2_000");
  });
});

describe("shouldCommit", () => {
  it("fires once the interval has fully elapsed", async () => {
    const { shouldCommit } = await import("@/lib/arena/crank");
    expect(shouldCommit(0, 300_000, 300_000)).toBe(true);
    expect(shouldCommit(0, 299_999, 300_000)).toBe(false);
    expect(shouldCommit(100_000, 400_000, 300_000)).toBe(true);
  });
});

describe("buildTickPlan", () => {
  it("caps remaining accounts per market at 10 and reports drops", async () => {
    const { buildTickPlan, MAX_TICK_BOTS } = await import("@/lib/arena/crank");
    expect(MAX_TICK_BOTS).toBe(10);
    const bots = Array.from({ length: 12 }, (_, i) => `bot${i}`);
    const plan = buildTickPlan([
      { marketId: 0, botPubkeys: bots },
      { marketId: 1, botPubkeys: ["a", "b"] },
    ]);
    expect(plan).toEqual([
      { marketId: 0, botPubkeys: bots.slice(0, 10), dropped: 2 },
      { marketId: 1, botPubkeys: ["a", "b"], dropped: 0 },
    ]);
  });
});
