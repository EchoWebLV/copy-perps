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

export function fallbackWhaleAnalysis(args: Pick<
  WhaleAnalysisArgs,
  "displayName" | "market" | "side" | "leverage"
>): WhaleAnalysis {
  return {
    summary: `${args.displayName} is ${args.side} ${args.market} at ${args.leverage}x.`,
    thesis:
      "The position is live and recently verified, but no AI analysis is cached yet.",
    risk:
      "Followers enter at the current market price and may not match the whale's original entry.",
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
