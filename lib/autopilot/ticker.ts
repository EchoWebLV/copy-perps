// lib/autopilot/ticker.ts
//
// The third in-process loop (whale ticker pattern): lease-guarded so
// exactly one process ticks, started from instrumentation.ts. Each tick
// first runs listActiveSessions() — ONE indexed query — and does nothing
// else when nobody is running autopilot (the Neon-cost lesson from the
// bot arena: idle loops must be near-free).

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const TICK_GAP_MS = Number(process.env.AUTOPILOT_TICK_GAP_MS ?? 60_000);
const LEASE_RECHECK_MS = 30_000;
const STARTUP_DELAY_MS = 5_000;
const HOLDER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

type AutopilotTickerDeps = {
  listActiveSessions: typeof import("./sessions").listActiveSessions;
  tickSession: typeof import("./engine").tickSession;
  buildEngineDeps: typeof import("./engine").buildEngineDeps;
  acquireAutopilotTickerLease: typeof import("./ticker-lease").acquireAutopilotTickerLease;
  ensureAutopilotLeaseTable: typeof import("./ticker-lease").ensureAutopilotLeaseTable;
};

let depsPromise: Promise<AutopilotTickerDeps> | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startAutopilotTicker(): void {
  if (process.env.DISABLE_AUTOPILOT_TICKER === "true") {
    console.log("[autopilot] ticker disabled via DISABLE_AUTOPILOT_TICKER");
    return;
  }
  const g = globalThis as typeof globalThis & {
    __autopilotTickerStarted?: boolean;
  };
  if (g.__autopilotTickerStarted) return;
  g.__autopilotTickerStarted = true;
  console.log(`[autopilot] ticker starting: holder=${HOLDER}`);
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  const {
    acquireAutopilotTickerLease,
    ensureAutopilotLeaseTable,
    listActiveSessions,
    tickSession,
    buildEngineDeps,
  } = await loadAutopilotTickerDeps();

  let tableReady = false;
  let wasHolder = false;
  let engineDeps: ReturnType<typeof buildEngineDeps> | null = null;

  for (;;) {
    if (!tableReady) {
      try {
        await ensureAutopilotLeaseTable();
        tableReady = true;
      } catch (err) {
        console.error("[autopilot] lease table not ready, retrying soon:", err);
        await sleep(LEASE_RECHECK_MS);
        continue;
      }
    }

    let holder = false;
    try {
      holder = await acquireAutopilotTickerLease(HOLDER);
    } catch (err) {
      console.error("[autopilot] lease check failed:", err);
    }

    if (!holder) {
      if (wasHolder) {
        console.log("[autopilot] lost the lease, another process is ticking");
        wasHolder = false;
      }
      await sleep(LEASE_RECHECK_MS);
      continue;
    }

    if (!wasHolder) {
      console.log("[autopilot] acquired the lease, this process is ticking");
      wasHolder = true;
    }

    try {
      // Cheap idle: one query; zero active sessions = zero further work.
      const sessions = await listActiveSessions();
      if (sessions.length > 0) {
        engineDeps ??= buildEngineDeps();
        for (const session of sessions) {
          try {
            const result = await tickSession(session, engineDeps);
            if (
              result.opened > 0 ||
              result.exited > 0 ||
              result.ended !== null ||
              result.skipped.length > 0
            ) {
              console.log(
                `[autopilot] session=${session.id} opened=${result.opened} exited=${result.exited}` +
                  ` ended=${result.ended ?? "no"}` +
                  (result.skipped.length > 0
                    ? ` skipped=[${result.skipped.join("; ")}]`
                    : ""),
              );
            }
          } catch (err) {
            console.error(`[autopilot] tick failed session=${session.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[autopilot] tick sweep failed:", err);
    }

    await sleep(TICK_GAP_MS);
  }
}

function loadAutopilotTickerDeps(): Promise<AutopilotTickerDeps> {
  depsPromise ??= Promise.all([
    import("./sessions"),
    import("./engine"),
    import("./ticker-lease"),
  ]).then(([sessions, engine, lease]) => ({
    listActiveSessions: sessions.listActiveSessions,
    tickSession: engine.tickSession,
    buildEngineDeps: engine.buildEngineDeps,
    acquireAutopilotTickerLease: lease.acquireAutopilotTickerLease,
    ensureAutopilotLeaseTable: lease.ensureAutopilotLeaseTable,
  }));
  return depsPromise;
}
