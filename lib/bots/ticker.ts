// lib/bots/ticker.ts
//
// In-process bot resolver loop. Started once per server process by
// instrumentation.ts (Next.js register hook) — on `next dev` and on
// `next start` (Railway prod) alike.
//
// This replaces the cron in vercel.json. Railway — our actual host —
// does not run vercel.json crons, so that config never ticked anything
// in production; the arena was effectively frozen. This loop is what
// keeps the bots alive AND what enforces their exit rules: stop-loss,
// max-hold, cooldown and mirror-close all only fire inside tick().
//
// Design:
//  - Sequential: one tick fully finishes before the next begins. No
//    overlap → no concurrent-tick dedup race (duplicate positions).
//  - Lease-guarded: dev and prod share one database, so a DB lease
//    (ticker-lease.ts) ensures exactly one process ticks at a time.
//    Whoever holds it ticks; others idle-poll and take over on death.
//  - Self-healing: a thrown tick is logged; the loop never dies.

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { tick } from "./resolver";
import { acquireTickerLease, ensureLeaseTable } from "./ticker-lease";

// Gap between the END of one tick and the START of the next while we
// hold the lease. Override with BOT_TICK_GAP_MS. Effective cadence ≈
// tick duration + gap (a tick currently runs ~35-40s, so ~50-55s).
const TICK_GAP_MS = Number(process.env.BOT_TICK_GAP_MS ?? 15_000);
// How often a non-holder re-checks whether the lease has freed up.
const LEASE_RECHECK_MS = 30_000;
// Let the server finish booting before the first (heavy) tick so it
// doesn't compete with startup work / first requests.
const STARTUP_DELAY_MS = 10_000;

// Identifies this process in the lease row. Unique per process so two
// processes never collide on the same holder string.
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Start the resolver loop. Safe to call more than once — a globalThis
 * flag guarantees a single loop per process even if register() fires
 * twice or dev HMR re-evaluates this module.
 *
 * Set DISABLE_BOT_TICKER=true to opt out entirely (e.g. if you later
 * move ticking into a dedicated worker service).
 */
export function startBotTicker(): void {
  if (process.env.DISABLE_BOT_TICKER === "true") {
    console.log("[bot-ticker] disabled via DISABLE_BOT_TICKER");
    return;
  }
  const g = globalThis as typeof globalThis & {
    __botTickerStarted?: boolean;
  };
  if (g.__botTickerStarted) return;
  g.__botTickerStarted = true;
  console.log(
    `[bot-ticker] starting — holder=${HOLDER}, gap=${TICK_GAP_MS}ms`,
  );
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);

  let tableReady = false;
  let wasHolder = false;

  for (;;) {
    // Provision the lease table once. If the DB is unreachable at
    // boot, keep retrying — don't wedge the loop permanently.
    if (!tableReady) {
      try {
        await ensureLeaseTable();
        tableReady = true;
      } catch (err) {
        console.error(
          "[bot-ticker] lease table not ready, retrying soon:",
          err,
        );
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
    }

    let holder = false;
    try {
      holder = await acquireTickerLease(HOLDER);
    } catch (err) {
      console.error("[bot-ticker] lease check failed:", err);
    }

    if (!holder) {
      if (wasHolder) {
        console.log(
          "[bot-ticker] lost the lease — another process is ticking",
        );
        wasHolder = false;
      }
      await sleep(LEASE_RECHECK_MS);
      continue;
    }

    if (!wasHolder) {
      console.log(
        "[bot-ticker] acquired the lease — this process is ticking",
      );
      wasHolder = true;
    }

    const start = Date.now();
    try {
      const r = await tick();
      console.log(
        `[bot-ticker] tick: ${r.opened} opened, ${r.closed} closed, ` +
          `${r.busted} busted in ${Date.now() - start}ms`,
      );
    } catch (err) {
      console.error("[bot-ticker] tick failed:", err);
    }

    await sleep(TICK_GAP_MS);
  }
}
