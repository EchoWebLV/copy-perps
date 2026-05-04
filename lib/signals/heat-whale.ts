import type { HLPosition } from "@/lib/hyperliquid/client";
import type { SignalChipData } from "@/lib/types";

const PRIORITY_ASSETS = new Set(["BTC", "ETH", "SOL", "HYPE", "DOGE"]);

export function whaleHeatScore(
  position: HLPosition,
  accountValueUsd: number,
): number {
  const sizeUsd = parseFloat(position.positionValue);
  const leverage = position.leverage?.value ?? 1;

  const sizePoints = Math.min(
    50,
    Math.log10(Math.max(1, sizeUsd / 1000)) * 14,
  );
  const leveragePoints = Math.min(20, leverage * 0.5);
  const accountPoints = Math.min(
    20,
    Math.log10(Math.max(1, accountValueUsd / 1000)) * 5,
  );
  const assetBoost = PRIORITY_ASSETS.has(position.coin) ? 10 : 0;

  return Math.round(
    Math.min(
      100,
      Math.max(0, sizePoints + leveragePoints + accountPoints + assetBoost),
    ),
  );
}

export function whaleSignalChips(
  position: HLPosition,
  accountValueUsd: number,
): SignalChipData[] {
  const chips: SignalChipData[] = [];

  const sizeUsd = parseFloat(position.positionValue);
  if (sizeUsd >= 1_000_000) {
    chips.push({
      text: `$${(sizeUsd / 1_000_000).toFixed(1)}M position`,
      level: "amber",
    });
  } else if (sizeUsd >= 100_000) {
    chips.push({
      text: `$${(sizeUsd / 1000).toFixed(0)}k position`,
      level: "amber",
    });
  }

  const upnl = parseFloat(position.unrealizedPnl);
  if (upnl > 10_000) {
    chips.push({
      text: `Up $${(upnl / 1000).toFixed(0)}k unrealized`,
      level: "green",
    });
  } else if (upnl < -10_000) {
    chips.push({
      text: `Down $${(Math.abs(upnl) / 1000).toFixed(0)}k unrealized`,
      level: "purple",
    });
  }

  if (accountValueUsd >= 10_000_000) {
    chips.push({
      text: `Whale account: $${(accountValueUsd / 1_000_000).toFixed(0)}M`,
      level: "purple",
    });
  } else if (accountValueUsd >= 1_000_000) {
    chips.push({
      text: `Account: $${(accountValueUsd / 1_000_000).toFixed(1)}M`,
      level: "purple",
    });
  }

  return chips.slice(0, 3);
}
