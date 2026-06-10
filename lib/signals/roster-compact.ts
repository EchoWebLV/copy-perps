import { buildCachedWhaleTraderSignals } from "@/lib/signals/whale-signals";
import type { WhaleTraderSignal } from "@/lib/types";

// Shared by the /api/whales/roster route and the /feed server component so
// SSR hydration and client polls return identically-shaped payloads.

const MAX_ROSTER_WHALES = Number(process.env.WHALE_ROSTER_LIMIT ?? 24);
const MAX_ROSTER_OPEN_POSITIONS = Number(
  process.env.WHALE_ROSTER_OPEN_POSITIONS ?? 3,
);
const MAX_ROSTER_PNL_POINTS = Number(process.env.WHALE_ROSTER_PNL_POINTS ?? 96);

export async function buildCompactRoster(): Promise<WhaleTraderSignal[]> {
  return (await buildCachedWhaleTraderSignals())
    .slice(0, MAX_ROSTER_WHALES)
    .map(compactWhaleTraderSignal);
}

/** Same as buildCompactRoster but gives up after `timeoutMs` and returns []
 *  — used by SSR so a cold stats cache degrades to the client-side skeleton
 *  instead of blocking first paint. The underlying build keeps running and
 *  warms the cache for the client's first poll. */
export async function buildCompactRosterWithTimeout(
  timeoutMs: number,
): Promise<WhaleTraderSignal[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WhaleTraderSignal[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  try {
    return await Promise.race([
      buildCompactRoster().catch(() => []),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
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
