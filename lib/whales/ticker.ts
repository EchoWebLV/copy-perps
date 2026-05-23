import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { refreshWhales } from "./refresh";
import { whaleSocialEnabled } from "@/lib/features";
import {
  acquireWhaleTickerLease,
  ensureWhaleLeaseTable,
} from "./ticker-lease";

const REFRESH_GAP_MS = Number(process.env.WHALE_REFRESH_GAP_MS ?? 15_000);
const LEASE_RECHECK_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startWhaleTicker(): void {
  if (!whaleSocialEnabled()) return;
  const g = globalThis as typeof globalThis & { __whaleTickerStarted?: boolean };
  if (g.__whaleTickerStarted) return;
  g.__whaleTickerStarted = true;
  console.log(`[whales] ticker starting: holder=${HOLDER}`);
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);

  let tableReady = false;
  let wasHolder = false;

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
