import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import {
  getClearinghouseState,
  type HLPosition,
} from "@/lib/hyperliquid/client";
import { CURATED_WHALES, truncateEthAddress } from "@/lib/hyperliquid/whales";
import { whaleHeatScore, whaleSignalChips } from "./heat-whale";
import type { WhaleSignal } from "@/lib/types";

const MIN_POSITION_USD = 50_000;
const MIN_LEVERAGE = 2;
const TOP_PER_WHALE = 2;
const FEED_LIMIT = 10;

export interface RefreshWhalesResult {
  fetched: number;
  qualified: number;
  inserted: number;
  errors: number;
}

interface Candidate {
  whale: { address: string; label?: string };
  position: HLPosition;
  accountValueUsd: number;
  score: number;
}

export async function refreshWhales(): Promise<RefreshWhalesResult> {
  let errors = 0;
  const candidates: Candidate[] = [];

  await Promise.all(
    CURATED_WHALES.map(async (whale) => {
      try {
        const state = await getClearinghouseState(whale.address);
        const accountValueUsd = parseFloat(state.marginSummary.accountValue);
        if (accountValueUsd <= 0) return;

        const positions = state.assetPositions
          .map((ap) => ap.position)
          .filter(
            (p) =>
              parseFloat(p.positionValue) >= MIN_POSITION_USD &&
              (p.leverage?.value ?? 0) >= MIN_LEVERAGE,
          )
          .sort(
            (a, b) =>
              parseFloat(b.positionValue) - parseFloat(a.positionValue),
          )
          .slice(0, TOP_PER_WHALE);

        for (const position of positions) {
          candidates.push({
            whale,
            position,
            accountValueUsd,
            score: whaleHeatScore(position, accountValueUsd, Date.now()),
          });
        }
      } catch (e) {
        console.warn("[refresh-whales] failed for", whale.address, e);
        errors++;
      }
    }),
  );

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, FEED_LIMIT);

  if (top.length === 0) {
    return {
      fetched: CURATED_WHALES.length,
      qualified: 0,
      inserted: 0,
      errors,
    };
  }

  const stamp = new Date();
  const newRows = top.map(({ whale, position, accountValueUsd, score }) => {
    const id = `whale:${whale.address.toLowerCase()}:${position.coin}`;
    const sizeNum = parseFloat(position.szi);
    const side: "long" | "short" = sizeNum >= 0 ? "long" : "short";
    const sizeUsd = parseFloat(position.positionValue);
    const entry = parseFloat(position.entryPx);
    const liquidation = position.liquidationPx
      ? parseFloat(position.liquidationPx)
      : 0;

    const payload: WhaleSignal = {
      id,
      type: "whale",
      heatScore: score,
      createdAt: stamp.toISOString(),
      walletAddress: whale.label ?? truncateEthAddress(whale.address),
      walletAccountValue: accountValueUsd,
      asset: position.coin,
      side,
      leverage: position.leverage?.value ?? 1,
      size: sizeUsd,
      entry,
      liquidation,
      openedAt: stamp.toISOString(),
      venue: "Hyperliquid",
      chips: whaleSignalChips(position, accountValueUsd, stamp.getTime()),
    };

    return {
      id,
      type: "whale",
      assetId: position.coin,
      heatScore: score,
      payload,
      createdAt: stamp,
    };
  });

  await db.delete(signals).where(eq(signals.type, "whale"));
  await db.insert(signals).values(newRows);

  return {
    fetched: CURATED_WHALES.length,
    qualified: top.length,
    inserted: newRows.length,
    errors,
  };
}
