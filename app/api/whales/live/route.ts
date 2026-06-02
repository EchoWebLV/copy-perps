import { NextResponse } from "next/server";
import { whaleSocialEnabled } from "@/lib/features";
import { buildWhalePositionSignals } from "@/lib/signals/whale-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  if (!whaleSocialEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const limit = parseLimit(request);
  // Surface every market the whales trade (not just Flash-tailable ones); the
  // UI gates the Tail button per-position via canTail.
  const positions = await buildWhalePositionSignals(limit, {
    includeNonCopyable: true,
  });
  positions.sort((a, b) => b.heatScore - a.heatScore);
  return NextResponse.json({ positions });
}

function parseLimit(request?: Request): number | undefined {
  if (!request) return undefined;
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null) return undefined;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1) return undefined;
  return Math.min(limit, 1000);
}
