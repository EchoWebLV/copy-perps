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

// Env values are untrusted: NaN or <=0 would coerce setTimeout to a ~1ms hot
// loop hammering the ER and the lease table, so fall back to the default.
function safeMs(raw: string | number, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TICK_GAP_MS = safeMs(process.env.ARENA_CRANK_INTERVAL_MS ?? 2_000, 2_000);
const COMMIT_GAP_MS = safeMs(
  process.env.ARENA_COMMIT_INTERVAL_MS ?? 300_000,
  300_000,
);
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

/**
 * The tick gap is ~2s but the lease only needs a heartbeat every 30s while
 * held (TTL 180s) — re-upserting Neon every tick would be ~43k writes/day
 * for nothing ("idle loops must be near-free", lib/autopilot/ticker.ts).
 */
export function shouldRecheckLease(
  wasHolder: boolean,
  lastCheckMs: number,
  nowMs: number,
  intervalMs: number = LEASE_RECHECK_MS,
): boolean {
  return !wasHolder || nowMs - lastCheckMs >= intervalMs;
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
  let deps: CrankDeps;
  try {
    deps = injected ?? (await buildCrankDeps());
  } catch (err) {
    // Designed fail-fast: without deps the worker is useless — exit cleanly
    // instead of dying via unhandled rejection on Railway.
    console.error("[arena] crank cannot start:", err);
    process.exitCode = 1;
    return;
  }

  let tableReady = false;
  let wasHolder = false;
  let lastLeaseCheckMs = 0;
  let lastCommitMs = 0;
  let tickCount = 0;
  const warnedDropMarkets = new Set<number>();

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

    let holder = wasHolder;
    if (shouldRecheckLease(wasHolder, lastLeaseCheckMs, Date.now())) {
      try {
        holder = await deps.acquireArenaCrankLease(HOLDER);
      } catch (err) {
        console.error("[arena] lease check failed:", err);
        holder = false;
      }
      lastLeaseCheckMs = Date.now();
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
        if (entry.dropped > 0 && !warnedDropMarkets.has(entry.marketId)) {
          warnedDropMarkets.add(entry.marketId);
          console.warn(
            `[arena] market=${entry.marketId} dropping ${entry.dropped} bots over the ${MAX_TICK_BOTS}-account tick cap (warned once)`,
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
