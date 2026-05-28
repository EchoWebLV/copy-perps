import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { whaleSocialEnabled } from "@/lib/features";
import type { SourceMonitorHandle } from "./source-monitor";

const REFRESH_GAP_MS = Number(process.env.WHALE_REFRESH_GAP_MS ?? 60_000);
const LEASE_RECHECK_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

type WhaleTickerDeps = {
  refreshWhales: typeof import("./refresh").refreshWhales;
  acquireWhaleTickerLease: typeof import("./ticker-lease").acquireWhaleTickerLease;
  ensureWhaleLeaseTable: typeof import("./ticker-lease").ensureWhaleLeaseTable;
  startWhaleSourceMonitor: typeof import("./source-monitor").startWhaleSourceMonitor;
};

let depsPromise: Promise<WhaleTickerDeps> | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startWhaleTicker(): void {
  if (process.env.DISABLE_WHALE_TICKER === "true") {
    console.log("[whales] ticker disabled via DISABLE_WHALE_TICKER");
    return;
  }
  if (!whaleSocialEnabled()) return;
  const g = globalThis as typeof globalThis & { __whaleTickerStarted?: boolean };
  if (g.__whaleTickerStarted) return;
  g.__whaleTickerStarted = true;
  console.log(`[whales] ticker starting: holder=${HOLDER}`);
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  const {
    acquireWhaleTickerLease,
    ensureWhaleLeaseTable,
    refreshWhales,
    startWhaleSourceMonitor,
  } = await loadWhaleTickerDeps();

  let tableReady = false;
  let wasHolder = false;
  let sourceMonitor: SourceMonitorHandle | null = null;

  for (;;) {
    if (!tableReady) {
      try {
        await ensureWhaleLeaseTable();
        tableReady = true;
      } catch (err) {
        console.error("[whales] lease table not ready, retrying soon:", err);
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
    }

    let holder = false;
    try {
      holder = await acquireWhaleTickerLease(HOLDER);
    } catch (err) {
      console.error("[whales] lease check failed:", err);
    }

    if (!holder) {
      if (sourceMonitor !== null) {
        sourceMonitor.stop();
        sourceMonitor = null;
      }
      if (wasHolder) {
        console.log("[whales] lost the lease, another process is refreshing");
        wasHolder = false;
      }
      await sleep(LEASE_RECHECK_MS);
      continue;
    }

    if (!wasHolder) {
      console.log("[whales] acquired the lease, this process is refreshing");
      wasHolder = true;
      sourceMonitor = startWhaleSourceMonitor();
    }

    const started = Date.now();
    try {
      const result = await refreshWhales();
      console.log(
        `[whales] refresh: ${result.whalesSeen} whales, ${result.positionsSeen} positions in ${Date.now() - started}ms`,
      );
    } catch (err) {
      console.error("[whales] refresh failed:", err);
    }
    await sleep(REFRESH_GAP_MS);
  }
}

function loadWhaleTickerDeps(): Promise<WhaleTickerDeps> {
  depsPromise ??= Promise.all([
    import("./refresh"),
    import("./ticker-lease"),
    import("./source-monitor"),
  ]).then(([refresh, lease, sourceMonitor]) => ({
    refreshWhales: refresh.refreshWhales,
    acquireWhaleTickerLease: lease.acquireWhaleTickerLease,
    ensureWhaleLeaseTable: lease.ensureWhaleLeaseTable,
    startWhaleSourceMonitor: sourceMonitor.startWhaleSourceMonitor,
  }));
  return depsPromise;
}
