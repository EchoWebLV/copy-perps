import type { JPEvent, JPMarket } from "@/lib/jupiter-prediction/client";
import type { SignalChipData } from "@/lib/types";

const fmtUsd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : `$${(n / 1000).toFixed(0)}k`;

export function predictionHeatScore(
  event: JPEvent,
  market: JPMarket,
): number {
  const vol24 = Number(event.volume24hr) / 1e6;
  const volPoints = Math.min(50, Math.log10(Math.max(1, vol24)) * 12);

  const closeTimeMs = market.closeTime * 1000;
  const daysUntilClose = (closeTimeMs - Date.now()) / (24 * 3600 * 1000);

  let timePoints = 0;
  if (daysUntilClose > 0 && daysUntilClose < 90) {
    timePoints = Math.max(5, 30 - daysUntilClose * 0.3);
  } else if (daysUntilClose >= 90 && daysUntilClose < 365) {
    timePoints = 5;
  }

  const categoryBoost =
    ["politics", "crypto", "sports", "us-elections", "election"].includes(
      event.category,
    )
      ? 10
      : 0;

  const liveBoost = event.isLive ? 8 : 0;

  return Math.round(
    Math.min(100, Math.max(0, volPoints + timePoints + categoryBoost + liveBoost)),
  );
}

export function predictionSignalChips(
  event: JPEvent,
  market: JPMarket,
): SignalChipData[] {
  const chips: SignalChipData[] = [];

  const vol24 = Number(event.volume24hr) / 1e6;
  if (vol24 > 10_000) {
    chips.push({ text: `${fmtUsd(vol24)} traded today`, level: "amber" });
  }

  const closeTimeMs = market.closeTime * 1000;
  const daysUntilClose =
    (closeTimeMs - Date.now()) / (24 * 3600 * 1000);
  if (daysUntilClose > 0 && daysUntilClose < 7) {
    chips.push({
      text: `Resolves in ${Math.max(1, Math.round(daysUntilClose))}d`,
      level: "green",
    });
  } else if (daysUntilClose >= 7 && daysUntilClose < 30) {
    chips.push({
      text: `Resolves in ${Math.round(daysUntilClose)}d`,
      level: "purple",
    });
  }

  const series = event.metadata.series;
  if (series) {
    chips.push({
      text: series.charAt(0).toUpperCase() + series.slice(1),
      level: "purple",
    });
  }

  return chips.slice(0, 3);
}
