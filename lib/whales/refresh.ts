import { refreshHyperliquidWhales } from "./refresh-hyperliquid";
import { refreshPacificaWhales } from "./refresh-pacifica";

export async function refreshWhales(): Promise<{
  whalesSeen: number;
  positionsSeen: number;
}> {
  const [pacifica, hyperliquid] = await Promise.allSettled([
    refreshPacificaWhales(),
    refreshHyperliquidWhales(),
  ]);

  if (pacifica.status === "rejected" && hyperliquid.status === "rejected") {
    throw new AggregateError(
      [pacifica.reason, hyperliquid.reason],
      "all whale refresh sources failed",
    );
  }

  if (pacifica.status === "rejected") {
    console.warn("[whales] Pacifica refresh failed:", pacifica.reason);
  }
  if (hyperliquid.status === "rejected") {
    console.warn("[whales] Hyperliquid refresh failed:", hyperliquid.reason);
  }

  const values = [pacifica, hyperliquid]
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<{
        whalesSeen: number;
        positionsSeen: number;
      }> => result.status === "fulfilled",
    )
    .map((result) => result.value);

  return {
    whalesSeen: values.reduce((sum, value) => sum + value.whalesSeen, 0),
    positionsSeen: values.reduce((sum, value) => sum + value.positionsSeen, 0),
  };
}
