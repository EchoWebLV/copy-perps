import { NextResponse } from "next/server";
import { whaleSocialEnabled } from "@/lib/features";
import { buildCachedWhaleTraderSignals } from "@/lib/signals/whale-signals";
import type { WhaleTraderSignal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROSTER_WHALES = Number(process.env.WHALE_ROSTER_LIMIT ?? 24);
const MAX_ROSTER_OPEN_POSITIONS = Number(
  process.env.WHALE_ROSTER_OPEN_POSITIONS ?? 3,
);
const MAX_ROSTER_PNL_POINTS = Number(process.env.WHALE_ROSTER_PNL_POINTS ?? 96);

export async function GET() {
  if (!whaleSocialEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const whales = (await buildCachedWhaleTraderSignals())
    .slice(0, MAX_ROSTER_WHALES)
    .map(compactWhaleTraderSignal);
  const response = NextResponse.json({ whales });
  response.headers.set(
    "Cache-Control",
    "public, max-age=10, stale-while-revalidate=30",
  );
  return response;
}

function compactWhaleTraderSignal(
  signal: WhaleTraderSignal,
): WhaleTraderSignal {
  return {
    ...signal,
    payload: {
      ...signal.payload,
      openPositions: signal.payload.openPositions.slice(
        0,
        MAX_ROSTER_OPEN_POSITIONS,
      ),
      stats: {
        ...signal.payload.stats,
        pnlCurve: samplePnlCurve(
          signal.payload.stats.pnlCurve,
          MAX_ROSTER_PNL_POINTS,
        ),
      },
    },
  };
}

function samplePnlCurve(
  points: WhaleTraderSignal["payload"]["stats"]["pnlCurve"],
  maxPoints: number,
): WhaleTraderSignal["payload"]["stats"]["pnlCurve"] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 1) return points.slice(-1);

  const lastIndex = points.length - 1;
  return Array.from({ length: maxPoints }, (_, idx) => {
    const pointIndex = Math.round((idx * lastIndex) / (maxPoints - 1));
    return points[pointIndex];
  });
}
