import type { HLPosition } from "@/lib/hyperliquid/client";
import type { SignalChipData } from "@/lib/types";

// Recency dominates: a fresh open is what makes the rail interesting.
// Bands keep the truly-fresh signals (sub-hour) at the top while still
// surfacing day-old opens above older holds.
function recencyBoost(openedAtMs: number): number {
  const ageHr = (Date.now() - openedAtMs) / 3_600_000;
  if (ageHr < 0.25) return 35;
  if (ageHr < 1) return 28;
  if (ageHr < 3) return 20;
  if (ageHr < 12) return 12;
  if (ageHr < 24) return 6;
  if (ageHr < 72) return 2;
  return 0;
}

function recencyChip(openedAtMs: number): SignalChipData | null {
  const ageMin = (Date.now() - openedAtMs) / 60_000;
  if (ageMin < 15) return { text: "Just opened", level: "amber" };
  if (ageMin < 60) {
    return { text: `Opened ${Math.round(ageMin)}m ago`, level: "amber" };
  }
  const ageHr = ageMin / 60;
  if (ageHr < 24) {
    return { text: `Opened ${ageHr.toFixed(1)}h ago`, level: "green" };
  }
  const ageDays = ageHr / 24;
  if (ageDays < 7) {
    return { text: `Opened ${Math.round(ageDays)}d ago`, level: "green" };
  }
  return null;
}

export function whaleHeatScore(
  position: HLPosition,
  accountValueUsd: number,
  openedAtMs: number,
): number {
  const sizeUsd = parseFloat(position.positionValue);
  const leverage = position.leverage?.value ?? 1;

  const sizePoints = Math.min(
    40,
    Math.log10(Math.max(1, sizeUsd / 1000)) * 12,
  );
  const leveragePoints = Math.min(15, leverage * 0.5);
  const accountPoints = Math.min(
    15,
    Math.log10(Math.max(1, accountValueUsd / 1000)) * 4,
  );

  return Math.round(
    Math.min(
      100,
      Math.max(
        0,
        sizePoints + leveragePoints + accountPoints + recencyBoost(openedAtMs),
      ),
    ),
  );
}

export function whaleSignalChips(
  position: HLPosition,
  accountValueUsd: number,
  openedAtMs: number,
): SignalChipData[] {
  const chips: SignalChipData[] = [];

  const recency = recencyChip(openedAtMs);
  if (recency) chips.push(recency);

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
