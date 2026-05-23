import { NextResponse } from "next/server";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const positions = await buildWhalePositionSignals();
  positions.sort((a, b) => b.heatScore - a.heatScore);
  return NextResponse.json({ positions });
}
