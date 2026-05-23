import { NextResponse } from "next/server";
import { buildWhaleTraderSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const whales = await buildWhaleTraderSignals();
  return NextResponse.json({ whales });
}
