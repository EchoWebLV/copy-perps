import { refreshPacificaWhales } from "./refresh-pacifica";
import { whaleSocialEnabled } from "@/lib/features";

const REFRESH_GAP_MS = Number(process.env.WHALE_REFRESH_GAP_MS ?? 15_000);
const STARTUP_DELAY_MS = 5_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function startWhaleTicker(): void {
  if (!whaleSocialEnabled()) return;
  const g = globalThis as typeof globalThis & { __whaleTickerStarted?: boolean };
  if (g.__whaleTickerStarted) return;
  g.__whaleTickerStarted = true;
  void loop();
}

async function loop(): Promise<void> {
  await sleep(STARTUP_DELAY_MS);
  for (;;) {
    const started = Date.now();
    try {
      const result = await refreshPacificaWhales();
      console.log(
        `[whales] refresh: ${result.whalesSeen} whales, ${result.positionsSeen} positions in ${Date.now() - started}ms`,
      );
    } catch (err) {
      console.error("[whales] refresh failed:", err);
    }
    await sleep(REFRESH_GAP_MS);
  }
}
