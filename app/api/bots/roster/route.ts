import { NextResponse } from "next/server";
import { buildBotSignals } from "@/lib/signals/bot-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Live roster — read by the client component on /feed every ~10s so
// bankroll, 24h PnL, and live position counts stay current without
// pulling the full /api/feed payload.
export async function GET() {
  const bots = await buildBotSignals();
  // Highest equity first — that's the scoreboard order. Busted falls
  // to the bottom naturally because equity ≈ 0.
  bots.sort((a, b) => b.payload.balanceUsd - a.payload.balanceUsd);
  return NextResponse.json({ bots });
}
