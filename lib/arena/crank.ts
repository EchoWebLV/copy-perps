// lib/arena/crank.ts
//
// The arena crank: exactly one process (lease-guarded) sends free `tick` txs
// to the Ephemeral Rollup every ~2s per market, and a `commit_state` every
// ~5 min. Prices arrive via MagicBlock's oracle pusher — the crank carries
// none; it can only delay bot reactions, never prices or recorded state.
//
// Runs on a dedicated Railway worker (scripts/arena/crank-worker.ts), NOT in
// instrumentation.ts. Chain deps are injected via CrankDeps so tests never
// touch a connection; buildCrankDeps() wires the real ER connection.

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const TICK_GAP_MS = Number(process.env.ARENA_CRANK_INTERVAL_MS ?? 2_000);
const COMMIT_GAP_MS = Number(process.env.ARENA_COMMIT_INTERVAL_MS ?? 300_000);
const LEASE_RECHECK_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/** ER compute headroom cap on remaining accounts per tick (spec §13 item 4). */
export const MAX_TICK_BOTS = 10;

export type CrankMarket = { marketId: number; botPubkeys: string[] };
export type TickPlanEntry = CrankMarket & { dropped: number };

export type CrankDeps = {
  ensureArenaLeaseTable: () => Promise<void>;
  acquireArenaCrankLease: (holder: string) => Promise<boolean>;
  /** Active markets + the bot accounts to pass as remaining accounts. */
  listMarkets: () => Promise<CrankMarket[]>;
  /** Send one tick(marketId) tx to the ER; returns the signature. */
  sendTick: (entry: TickPlanEntry) => Promise<string>;
  /** Commit delegated state to the base layer; returns the signature. */
  sendCommit: () => Promise<string>;
};

export function shouldCommit(
  lastCommitMs: number,
  nowMs: number,
  intervalMs: number,
): boolean {
  return nowMs - lastCommitMs >= intervalMs;
}

export function buildTickPlan(markets: CrankMarket[]): TickPlanEntry[] {
  return markets.map((m) => ({
    marketId: m.marketId,
    botPubkeys: m.botPubkeys.slice(0, MAX_TICK_BOTS),
    dropped: Math.max(0, m.botPubkeys.length - MAX_TICK_BOTS),
  }));
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startArenaCrank(deps?: CrankDeps): void {
  if (process.env.DISABLE_ARENA_CRANK === "true") {
    console.log("[arena] crank disabled via DISABLE_ARENA_CRANK");
    return;
  }
  const g = globalThis as typeof globalThis & { __arenaCrankStarted?: boolean };
  if (g.__arenaCrankStarted) return;
  g.__arenaCrankStarted = true;
  console.log(`[arena] crank starting: holder=${HOLDER}`);
  void loop(deps);
}

async function loop(injected?: CrankDeps): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  const deps = injected ?? (await buildCrankDeps());

  let tableReady = false;
  let wasHolder = false;
  let lastCommitMs = 0;
  let tickCount = 0;

  for (;;) {
    if (!tableReady) {
      try {
        await deps.ensureArenaLeaseTable();
        tableReady = true;
      } catch (err) {
        console.error("[arena] lease table not ready, retrying soon:", err);
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
    }

    let holder = false;
    try {
      holder = await deps.acquireArenaCrankLease(HOLDER);
    } catch (err) {
      console.error("[arena] lease check failed:", err);
    }

    if (!holder) {
      if (wasHolder) {
        console.log("[arena] lost the lease, another process is cranking");
        wasHolder = false;
      }
      await sleep(LEASE_RECHECK_MS);
      continue;
    }

    if (!wasHolder) {
      console.log("[arena] acquired the lease, this process is cranking");
      wasHolder = true;
    }

    try {
      const plan = buildTickPlan(await deps.listMarkets());
      for (const entry of plan) {
        if (entry.dropped > 0) {
          console.warn(
            `[arena] market=${entry.marketId} dropping ${entry.dropped} bots over the ${MAX_TICK_BOTS}-account tick cap`,
          );
        }
        try {
          await deps.sendTick(entry);
          tickCount += 1;
          if (tickCount % 100 === 0) {
            console.log(`[arena] ${tickCount} ticks sent (holder=${HOLDER})`);
          }
        } catch (err) {
          console.error(`[arena] tick failed market=${entry.marketId}:`, err);
        }
      }

      if (shouldCommit(lastCommitMs, Date.now(), COMMIT_GAP_MS)) {
        try {
          const sig = await deps.sendCommit();
          lastCommitMs = Date.now();
          console.log(`[arena] committed state to base layer: ${sig}`);
        } catch (err) {
          console.error("[arena] commit failed:", err);
        }
      }
    } catch (err) {
      console.error("[arena] crank sweep failed:", err);
    }

    await sleep(TICK_GAP_MS);
  }
}

/**
 * Real chain wiring (ER connection, tick/commit tx builders against the
 * deployed arena program). Implemented once the program is deployed
 * (plan Task 13/14); the loop and worker entry are testable without it.
 */
async function buildCrankDeps(): Promise<CrankDeps> {
  throw new Error(
    "[arena] buildCrankDeps not wired yet — deploy the arena program (plan Task 13) and wire ARENA_PROGRAM_ID/ARENA_ER_ENDPOINT first",
  );
}
