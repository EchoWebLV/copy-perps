import { refreshHyperliquidWhales } from "./refresh-hyperliquid";
import { refreshOstiumWhales } from "./refresh-ostium";
import { refreshPacificaWhales } from "./refresh-pacifica";

type RefreshResult = { whalesSeen: number; positionsSeen: number };

export async function refreshWhales(): Promise<RefreshResult> {
  const sources: Array<[string, Promise<RefreshResult>]> = [
    ["Pacifica", refreshPacificaWhales()],
    ["Hyperliquid", refreshHyperliquidWhales()],
    ["Ostium", refreshOstiumWhales()],
  ];

  const settled = await Promise.allSettled(sources.map(([, p]) => p));

  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<RefreshResult> => r.status === "fulfilled",
  );

  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      console.warn(`[whales] ${sources[i]![0]} refresh failed:`, result.reason);
    }
  });

  if (fulfilled.length === 0) {
    throw new AggregateError(
      settled.map((r) => (r as PromiseRejectedResult).reason),
      "all whale refresh sources failed",
    );
  }

  return {
    whalesSeen: fulfilled.reduce((sum, r) => sum + r.value.whalesSeen, 0),
    positionsSeen: fulfilled.reduce((sum, r) => sum + r.value.positionsSeen, 0),
  };
}
