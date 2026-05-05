import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { signals } from "@/lib/db/schema";
import { listEvents, type JPEvent, type JPMarket } from "@/lib/jupiter-prediction/client";
import { predictionHeatScore, predictionSignalChips } from "./heat-prediction";
import type {
  PredictionSignal,
  MultiPredictionSignal,
  MultiPredictionOutcome,
} from "@/lib/types";

const MIN_VOLUME_24H_USD = 10_000;
const MAX_DAYS_TO_RESOLVE = 365;
const FEED_LIMIT = 10;
const MULTI_OUTCOMES_TO_SHOW = 4;

export interface RefreshPredictionsResult {
  fetched: number;
  qualified: number;
  inserted: number;
}

function openFutureMarkets(event: JPEvent): JPMarket[] {
  const now = Date.now() / 1000;
  return event.markets.filter(
    (m) => m.status === "open" && m.closeTime > now,
  );
}

function fmtResolveDate(closeTime: number): string {
  return new Date(closeTime * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Candidate =
  | { kind: "binary"; event: JPEvent; market: JPMarket; score: number }
  | {
      kind: "multi";
      event: JPEvent;
      markets: JPMarket[];
      outcomes: MultiPredictionOutcome[];
      score: number;
    };

export async function refreshPredictions(): Promise<RefreshPredictionsResult> {
  const events = await listEvents({ limit: 50 });

  const now = Date.now();
  const candidates: Candidate[] = [];

  for (const ev of events) {
    if (!ev.isActive) continue;

    const open = openFutureMarkets(ev);
    if (open.length === 0) continue;

    const days = open
      .map((m) => (m.closeTime * 1000 - now) / (24 * 3600 * 1000))
      .reduce((min, v) => Math.min(min, v), Infinity);
    if (days > MAX_DAYS_TO_RESOLVE) continue;

    const vol24 = Number(ev.volume24hr) / 1e6;
    if (vol24 < MIN_VOLUME_24H_USD) continue;

    if (open.length === 1) {
      const market = open[0];
      const yesPrice = parseFloat(market.outcomePrices?.[0] ?? "0");
      if (!Number.isFinite(yesPrice)) continue;
      if (yesPrice >= 0.99 || yesPrice <= 0.005) continue;

      const score = predictionHeatScore(ev, market);
      candidates.push({ kind: "binary", event: ev, market, score });
    } else {
      const outcomes = open
        .map((m) => ({
          label: m.title,
          marketId: m.marketId,
          yesProbability: parseFloat(m.outcomePrices?.[0] ?? "0"),
        }))
        .filter(
          (o) =>
            Number.isFinite(o.yesProbability) &&
            o.yesProbability > 0.005 &&
            o.yesProbability < 0.99,
        )
        .sort((a, b) => b.yesProbability - a.yesProbability);

      if (outcomes.length === 0) continue;

      // Score from the leading market
      const leadMarket =
        open.find((m) => m.marketId === outcomes[0].marketId) ?? open[0];
      const score = predictionHeatScore(ev, leadMarket);
      candidates.push({
        kind: "multi",
        event: ev,
        markets: open,
        outcomes,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, FEED_LIMIT);

  if (top.length === 0) {
    return { fetched: events.length, qualified: 0, inserted: 0 };
  }

  const stamp = new Date();
  const newRows = top.map((c) => {
    if (c.kind === "binary") {
      const { event, market, score } = c;
      const id = `prediction:${event.eventId}:${market.marketId}`;
      const yesProbability = parseFloat(market.outcomePrices[0]);

      const payload: PredictionSignal = {
        id,
        type: "prediction",
        heatScore: score,
        createdAt: stamp.toISOString(),
        question: event.metadata.title,
        resolveDate: fmtResolveDate(market.closeTime),
        resolveAt: market.closeTime,
        volume24h: Number(event.volume24hr) / 1e6,
        yesProbability,
        eventId: event.eventId,
        marketId: market.marketId,
        series: event.metadata.series,
        imageUrl: market.imageUrl ?? event.metadata.imageUrl ?? null,
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
    }

    const { event, markets, outcomes, score } = c;
    const id = `multiprediction:${event.eventId}`;
    const earliestClose = Math.min(...markets.map((m) => m.closeTime));
    const leadMarket =
      markets.find((m) => m.marketId === outcomes[0].marketId) ?? markets[0];

    const payload: MultiPredictionSignal = {
      id,
      type: "multiprediction",
      heatScore: score,
      createdAt: stamp.toISOString(),
      question: event.metadata.title,
      resolveDate: fmtResolveDate(earliestClose),
      resolveAt: earliestClose,
      volume24h: Number(event.volume24hr) / 1e6,
      eventId: event.eventId,
      series: event.metadata.series,
      outcomes: outcomes.slice(0, MULTI_OUTCOMES_TO_SHOW),
      totalOutcomes: outcomes.length,
      imageUrl: event.metadata.imageUrl ?? null,
      chips: predictionSignalChips(event, leadMarket),
    };

    return {
      id,
      type: "multiprediction",
      assetId: event.eventId,
      heatScore: score,
      payload,
      createdAt: stamp,
    };
  });

  // Drop both single and multi prediction rows; we re-write both flavors.
  await db.delete(signals).where(eq(signals.type, "prediction"));
  await db.delete(signals).where(eq(signals.type, "multiprediction"));
  await db.insert(signals).values(newRows);

  return {
    fetched: events.length,
    qualified: top.length,
    inserted: newRows.length,
  };
}
