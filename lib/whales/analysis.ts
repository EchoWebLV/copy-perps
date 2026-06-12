import { z } from "zod";
import {
  generateXaiJson,
  XAI_RESPONSES_MODEL_ID,
} from "@/lib/xai/responses";
import type { WhaleSide, WhaleSource } from "./types";

const MODEL_ID = XAI_RESPONSES_MODEL_ID;

export const WhaleAnalysisSchema = z.object({
  summary: z.string().min(1),
  thesis: z.string().min(1),
  risk: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type WhaleAnalysis = z.infer<typeof WhaleAnalysisSchema>;

export interface WhaleAnalysisArgs {
  displayName: string;
  source: WhaleSource;
  market: string;
  side: WhaleSide;
  leverage: number;
  entryPrice: number;
  currentMark: number | null;
  notionalUsd: number;
  openedAtMs: number;
}

export interface WhaleAnalysisResult extends WhaleAnalysis {
  entryGapWarning: string | null;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

export function whaleEntryGapWarning(args: {
  side: WhaleSide;
  sourceEntry: number;
  currentMark: number | null;
}): string | null {
  if (
    args.currentMark == null ||
    !Number.isFinite(args.currentMark) ||
    args.currentMark <= 0 ||
    !Number.isFinite(args.sourceEntry) ||
    args.sourceEntry <= 0
  ) {
    return null;
  }

  const diffPct = ((args.currentMark - args.sourceEntry) / args.sourceEntry) * 100;
  if (Math.abs(diffPct) < 1) return null;

  const relation =
    diffPct > 0
      ? `${Math.abs(diffPct).toFixed(1)}% above`
      : `${Math.abs(diffPct).toFixed(1)}% below`;

  return `Current mark is ${relation} the whale entry. Followers enter at the live price, not the whale entry.`;
}

export function buildWhaleAnalysisPrompt(args: WhaleAnalysisArgs): string {
  return [
    "Analyze this public whale perpetual futures position for a copy trading feed.",
    `Display name: ${args.displayName}`,
    `Source: ${args.source}`,
    `Market: ${args.market}`,
    `Side: ${args.side}`,
    `Leverage: ${args.leverage}x`,
    `Entry: ${args.entryPrice}`,
    `Current mark: ${args.currentMark ?? "unknown"}`,
    `Notional USD: ${args.notionalUsd}`,
    `Opened at ms: ${args.openedAtMs}`,
    "Explain likely public market context, not private intent.",
    "Do not claim to know private intent.",
    "Include one risk caveat for a follower entering now.",
  ].join("\n");
}

function formatLeverage(leverage: number): string {
  return Number.isInteger(leverage)
    ? `${leverage}x`
    : `${leverage.toFixed(1).replace(/\.0$/, "")}x`;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";

  const units = [
    { floor: 1_000_000_000, suffix: "B" },
    { floor: 1_000_000, suffix: "M" },
    { floor: 1_000, suffix: "K" },
  ] as const;
  const unit = units.find((item) => value >= item.floor);
  if (!unit) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  const scaled = value / unit.floor;
  const digits = scaled >= 100 || Number.isInteger(scaled) ? 0 : 1;
  return `$${scaled.toFixed(digits).replace(/\.0$/, "")}${unit.suffix}`;
}

function entryDeltaPct(args: {
  entryPrice: number;
  currentMark: number | null;
}): number | null {
  if (
    args.currentMark == null ||
    !Number.isFinite(args.currentMark) ||
    args.currentMark <= 0 ||
    !Number.isFinite(args.entryPrice) ||
    args.entryPrice <= 0
  ) {
    return null;
  }

  return ((args.currentMark - args.entryPrice) / args.entryPrice) * 100;
}

function fallbackThesis(args: Pick<
  WhaleAnalysisArgs,
  "market" | "side" | "entryPrice" | "currentMark"
>): string {
  const delta = entryDeltaPct(args);
  if (delta === null) {
    return `Current mark is unavailable, so the useful signal is exposure: a live ${args.side} on ${args.market}, not confirmed momentum from price.`;
  }

  const abs = Math.abs(delta).toFixed(1);
  if (Math.abs(delta) < 1) {
    return `The mark is close to entry, so a follower is near the whale fill. The live signal is fresh ${args.side} exposure on ${args.market}.`;
  }

  if (args.side === "long" && delta > 0) {
    return `The mark is ${abs}% above entry, so the trade is already working. Copying now means buying after the whale's fill and relying on continued upside.`;
  }

  if (args.side === "long") {
    return `The mark is ${abs}% below entry, so a follower enters better than the whale fill. The whale is still holding through drawdown, which keeps liquidation risk active.`;
  }

  if (delta < 0) {
    return `The mark is ${abs}% below entry, so the short is already working. Copying now means entering after part of the downside move has happened.`;
  }

  return `The mark is ${abs}% above entry, so the whale is holding a losing short. That reads as a contrarian downside setup with tight timing risk.`;
}

export function fallbackWhaleAnalysis(args: Pick<
  WhaleAnalysisArgs,
  | "displayName"
  | "market"
  | "side"
  | "leverage"
  | "entryPrice"
  | "currentMark"
  | "notionalUsd"
  | "openedAtMs"
  | "source"
>): WhaleAnalysis {
  const leverage = formatLeverage(args.leverage);
  return {
    summary: `${args.displayName} is carrying a ${leverage} ${args.side} on ${args.market} with about ${formatCompactUsd(args.notionalUsd)} live.`,
    thesis: fallbackThesis(args),
    risk: `${leverage} leverage makes entry timing matter. Followers enter at the live mark, may not share the whale's margin, and can be forced out before the whale closes.`,
    confidence: 0.25,
  };
}

export async function generateWhaleAnalysis(
  args: WhaleAnalysisArgs,
): Promise<WhaleAnalysisResult> {
  const entryGapWarning = whaleEntryGapWarning({
    side: args.side,
    sourceEntry: args.entryPrice,
    currentMark: args.currentMark,
  });

  try {
    const object = await generateXaiJson({
      schema: WhaleAnalysisSchema,
      prompt: buildWhaleAnalysisPrompt(args),
      maxOutputTokens: 600,
    });
    const now = new Date();
    return {
      ...object,
      entryGapWarning,
      model: MODEL_ID,
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    const now = new Date();
    return {
      ...fallbackWhaleAnalysis(args),
      entryGapWarning,
      model: "fallback",
      createdAt: now,
      updatedAt: now,
    };
  }
}
