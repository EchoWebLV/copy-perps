// instrumentation.ts
//
// Next.js startup hook. register() runs once per server process when
// it boots — on `next dev` locally and on `next start` (Railway prod)
// alike. It does NOT run during `next build`.
//
// We use it to start the in-process whale ticker (roster refresh + the
// live source-monitor that powers the real-money copy/tail product).
// Railway does not run vercel.json crons, so this hook is what keeps
// those loops alive in production. The bot-arena resolver loop is
// deliberately NOT started here — see the note in register() below.

import { suppressKnownRuntimeWarnings } from "@/lib/runtime/console-noise";

export async function register(): Promise<void> {
  // Only the Node.js server runtime — never the edge runtime. The
  // resolver needs Node APIs (os, crypto) and direct DB access. The
  // dynamic import keeps that Node-only code out of the edge bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  suppressKnownRuntimeWarnings();

  // Bot arena (paper-trading resolver loop) is intentionally NOT started.
  // Its ~50s tick plus a per-tick lease heartbeat kept the database awake
  // 24/7 — the bulk of the Neon compute bill. The engine and its data are
  // untouched (lib/bots/*, paper_positions); only the boot is removed.
  // To re-enable, restore the startBotTicker() import + call here.
  const { startWhaleTicker } = await import("@/lib/whales/ticker");
  startWhaleTicker();

  // Scalp Autopilot loop (Phase 3c). Lease-guarded like the whale ticker;
  // near-free when idle (one indexed query per tick, no market data).
  // Kill switch: DISABLE_AUTOPILOT_TICKER=true.
  const { startAutopilotTicker } = await import("@/lib/autopilot/ticker");
  startAutopilotTicker();

  // Flash copy-trading loop: mirrors targets' opens into followers'
  // wallets and closes copies when the source exits. Idle ticks are two
  // indexed queries per 30s; fast (3s) ticks only run while a target is
  // actually being watched and are RPC-bound, not DB-bound.
  // Kill switches: DISABLE_COPY_TICKER=true, COPY_DRY_RUN=true.
  const { startCopyTicker } = await import("@/lib/copy/ticker");
  startCopyTicker();
}
