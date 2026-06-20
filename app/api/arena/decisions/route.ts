// app/api/arena/decisions/route.ts
//
// Serves recent oracle-bot "thoughts" (persisted reasoning + tx) for the
// MagicBlock log's why-line. Read-only over arena_decisions; the operator
// worker is the sole writer. `?bots=claude-v1,grok-v1` narrows the set; with no
// param it returns the full registry roster. A DB hiccup degrades to an empty
// map (HTTP 200) so the log just renders without the why-line, never an error.
import { NextResponse, type NextRequest } from "next/server";
import { getRecentArenaThoughts } from "@/lib/arena/llm/decision-store";
import { ORACLE_BOTS } from "@/lib/arena/llm/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("bots");
  const personas = param
    ? param.split(",").map((s) => s.trim()).filter(Boolean)
    : ORACLE_BOTS.map((b) => b.persona);

  try {
    const bots = await getRecentArenaThoughts(personas, 40);
    return NextResponse.json({ bots });
  } catch (e) {
    return NextResponse.json({ bots: {}, error: (e as Error).message });
  }
}
