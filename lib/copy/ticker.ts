// lib/copy/ticker.ts
//
// In-process loop for the Flash copy engine (whale/autopilot ticker
// pattern: lease-guarded so exactly one process ticks, started from
// instrumentation.ts).
//
// Cadence is two-speed to respect the Neon-cost rule (idle loops must be
// near-free) while still catching 50-second scalper positions:
//  - Lease beats every 30s (one upsert).
//  - The engine tick itself loads the watch set (two indexed queries); when
//    it comes back empty we sleep 30s — idle cost ≈ the autopilot ticker.
//  - While targets are being watched we tick every COPY_TICK_GAP_MS (3s
//    default). The fast path is RPC-bound (ER account reads + positionsOf);
//    DB writes only happen on actual copy events.

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const TICK_GAP_MS = Number(process.env.COPY_TICK_GAP_MS ?? 3_000);
const IDLE_GAP_MS = 30_000;
const LEASE_RECHECK_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

type CopyTickerDeps = {
  tickCopyEngine: typeof import("./engine").tickCopyEngine;
  buildCopyEngineDeps: typeof import("./engine").buildCopyEngineDeps;
  createCopyEngineState: typeof import("./engine").createCopyEngineState;
  acquireCopyTickerLease: typeof import("./ticker-lease").acquireCopyTickerLease;
  ensureCopyLeaseTable: typeof import("./ticker-lease").ensureCopyLeaseTable;
};

let depsPromise: Promise<CopyTickerDeps> | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startCopyTicker(): void {
  if (process.env.DISABLE_COPY_TICKER === "true") {
    console.log("[copy] ticker disabled via DISABLE_COPY_TICKER");
    return;
  }
  const g = globalThis as typeof globalThis & { __copyTickerStarted?: boolean };
  if (g.__copyTickerStarted) return;
  g.__copyTickerStarted = true;
  console.log(
    `[copy] ticker starting: holder=${HOLDER}` +
      (process.env.COPY_DRY_RUN === "true" ? " (DRY RUN)" : ""),
  );
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  const {
    tickCopyEngine,
    buildCopyEngineDeps,
    createCopyEngineState,
    acquireCopyTickerLease,
    ensureCopyLeaseTable,
  } = await loadCopyTickerDeps();

  let tableReady = false;
  let wasHolder = false;
  let engineDeps: ReturnType<typeof buildCopyEngineDeps> | null = null;
  let engineState = createCopyEngineState();
  let lastLeaseCheckMs = 0;

  for (;;) {
    if (!tableReady) {
      try {
        await ensureCopyLeaseTable();
        tableReady = true;
      } catch (err) {
        console.error("[copy] lease table not ready, retrying soon:", err);
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
    }

    // Lease beats are decoupled from the fast tick: between beats the
    // current holder keeps cranking without DB writes.
    const nowMs = Date.now();
    if (nowMs - lastLeaseCheckMs >= LEASE_RECHECK_MS) {
      let holder = false;
      try {
        holder = await acquireCopyTickerLease(HOLDER);
        lastLeaseCheckMs = nowMs;
      } catch (err) {
        console.error("[copy] lease check failed:", err);
      }
      if (!holder) {
        if (wasHolder) {
          console.log("[copy] lost the lease, another process is ticking");
          wasHolder = false;
          engineState = createCopyEngineState(); // stale baselines are toxic
        }
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
      if (!wasHolder) {
        console.log("[copy] acquired the lease, this process is ticking");
        wasHolder = true;
        engineState = createCopyEngineState();
      }
    } else if (!wasHolder) {
      await sleep(LEASE_RECHECK_MS);
      continue;
    }

    let idle = true;
    try {
      engineDeps ??= buildCopyEngineDeps();
      const result = await tickCopyEngine(engineState, engineDeps);
      idle = result.targets === 0;
      if (
        result.opened > 0 ||
        result.closed > 0 ||
        result.planned.length > 0 ||
        result.errors.length > 0
      ) {
        console.log(
          `[copy] tick targets=${result.targets} opened=${result.opened} closed=${result.closed}` +
            (result.planned.length > 0
              ? ` planned=[${result.planned.join("; ")}]`
              : "") +
            (result.skipped.length > 0
              ? ` skipped=[${result.skipped.join("; ")}]`
              : "") +
            (result.errors.length > 0
              ? ` errors=[${result.errors.join("; ")}]`
              : ""),
        );
      }
    } catch (err) {
      console.error("[copy] tick failed:", err);
    }

    await sleep(idle ? IDLE_GAP_MS : TICK_GAP_MS);
  }
}

function loadCopyTickerDeps(): Promise<CopyTickerDeps> {
  depsPromise ??= Promise.all([
    import("./engine"),
    import("./ticker-lease"),
  ]).then(([engine, lease]) => ({
    tickCopyEngine: engine.tickCopyEngine,
    buildCopyEngineDeps: engine.buildCopyEngineDeps,
    createCopyEngineState: engine.createCopyEngineState,
    acquireCopyTickerLease: lease.acquireCopyTickerLease,
    ensureCopyLeaseTable: lease.ensureCopyLeaseTable,
  }));
  return depsPromise;
}
