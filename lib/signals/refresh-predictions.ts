import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { listEvents, type JPEvent, type JPMarket } from "@/lib/jupiter-prediction/client";
import { predictionHeatScore, predictionSignalChips } from "./heat-prediction";
import type { PredictionSignal } from "@/lib/types";

const MIN_VOLUME_24H_USD = 10_000;
const MAX_DAYS_TO_RESOLVE = 365;
const FEED_LIMIT = 10;

export interface RefreshPredictionsResult {
  fetched: number;
  qualified: number;
  inserted: number;
}

function pickPrimaryMarket(event: JPEvent): JPMarket | null {
  const open = event.markets.filter((m) => m.status === "open");
  if (open.length === 0) return null;

  const now = Date.now() / 1000;
  const future = open
    .filter((m) => m.closeTime > now)
    .sort((a, b) => a.closeTime - b.closeTime);
  return future[0] ?? open[0];
}

function fmtResolveDate(closeTime: number): string {
  return new Date(closeTime * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function refreshPredictions(): Promise<RefreshPredictionsResult> {
  const events = await listEvents({ limit: 50 });

  const now = Date.now();
  const candidates: { event: JPEvent; market: JPMarket; score: number }[] = [];

  for (const ev of events) {
    if (!ev.isActive) continue;

    const market = pickPrimaryMarket(ev);
    if (!market) continue;

    const closeMs = market.closeTime * 1000;
    if (closeMs < now) continue;
    const days = (closeMs - now) / (24 * 3600 * 1000);
    if (days > MAX_DAYS_TO_RESOLVE) continue;

    const vol24 = Number(ev.volume24hr) / 1e6;
    if (vol24 < MIN_VOLUME_24H_USD) continue;

    const yesPrice = parseFloat(market.outcomePrices?.[0] ?? "0");
    if (!Number.isFinite(yesPrice)) continue;
    if (yesPrice >= 0.99 || yesPrice <= 0.005) continue;

    const score = predictionHeatScore(ev, market);
    candidates.push({ event: ev, market, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, FEED_LIMIT);

  if (top.length === 0) {
    return { fetched: events.length, qualified: 0, inserted: 0 };
  }

  const stamp = new Date();
  const newRows = top.map(({ event, market, score }) => {
    const id = `prediction:${event.eventId}:${market.marketId}`;
    const yesProbability = parseFloat(market.outcomePrices[0]);

    const payload: PredictionSignal = {
      id,
      type: "prediction",
      heatScore: score,
      createdAt: stamp.toISOString(),
      question: event.metadata.title,
      resolveDate: fmtResolveDate(market.closeTime),
      volume24h: Number(event.volume24hr) / 1e6,
      yesProbability,
      eventId: event.eventId,
      marketId: market.marketId,
      series: event.metadata.series,
      chips: predictionSignalChips(event, market),
    };

    return {
      id,
      type: "prediction",
      assetId: market.marketId,
      heatScore: score,
      payload,
      createdAt: stamp,
    };
  });

  await db.delete(signals).where(eq(signals.type, "prediction"));
  await db.insert(signals).values(newRows);

  return {
    fetched: events.length,
    qualified: top.length,
    inserted: newRows.length,
  };
}
