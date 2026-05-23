import { NextResponse } from "next/server";
import { whaleSocialEnabled } from "@/lib/features";
import { buildWhaleTraderSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!whaleSocialEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const whales = await buildWhaleTraderSignals();
  return NextResponse.json({ whales });
}
