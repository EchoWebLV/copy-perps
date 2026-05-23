import { NextResponse } from "next/server";
import { whaleSocialEnabled } from "@/lib/features";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!whaleSocialEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const positions = await buildWhalePositionSignals();
  positions.sort((a, b) => b.heatScore - a.heatScore);
  return NextResponse.json({ positions });
}
