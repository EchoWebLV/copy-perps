// instrumentation.ts
//
// Next.js startup hook. register() runs once per server process when
// it boots — on `next dev` locally and on `next start` (Railway prod)
// alike. It does NOT run during `next build`.
//
// We use it to start the in-process bot resolver loop. Railway does
// not run vercel.json crons, so this is what actually keeps the arena
// ticking in production. The loop is lease-guarded (lib/bots/ticker.ts)
// so it stays correct even when a local dev server and the Railway
// prod server are both up against the shared database.

export async function register(): Promise<void> {
  // Only the Node.js server runtime — never the edge runtime. The
  // resolver needs Node APIs (os, crypto) and direct DB access. The
  // dynamic import keeps that Node-only code out of the edge bundle.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBotTicker } = await import("@/lib/bots/ticker");
  startBotTicker();
}
