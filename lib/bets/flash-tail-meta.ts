import type { FlashTradeMode } from "@/lib/flash/markets";

export type TailLineage = {
  sourceKind: "whale" | "bot" | "autopilot";
  whaleId: string | null;
  botId: string | null;
  sourceName: string | null;
  sourcePositionId: string | null;
};

export type FlashTailMeta = {
  sourceType: "flash-tail";
  venue: "flash";
  sourceKind: "whale" | "bot" | "autopilot";
  whaleId: string | null;
  botId: string | null;
  sourceName: string | null;
  sourcePositionId: string | null;
  // Set when sourceKind === 'autopilot': the autopilot_sessions row that
  // opened this trade. Optional so pre-Phase-3c meta literals/rows still
  // typecheck; build/parse always normalize it to string | null.
  autopilotSessionId?: string | null;
  market: string;
  side: "long" | "short";
  leverage: number;
  mode: FlashTradeMode;
  walletAddress: string;
  entryPriceUsd: number | null; // quote-time estimate; reconcile upgrades
  notionalUsd: number | null;
  openFeeUsd: number | null;
  openSignature: string | null;
  closeSignature: string | null;
  // 'external' = position vanished on-chain without a close postback
  // (liquidation, TP/SL trigger, lost confirm) — stamped by the reconcile
  // sweep alongside status 'closed-external'; proceeds stay unknown.
  closeReason: "manual" | "external" | null;
  proceedsSource: "quote-estimate" | "chain" | null;
  reconciledAt: string | null; // ISO; set once the open fill is chain-verified
};

type BuildArgs = {
  lineage: TailLineage;
  market: string;
  side: "long" | "short";
  leverage: number;
  mode: FlashTradeMode;
  walletAddress: string;
  entryPriceUsd: number | null;
  notionalUsd: number | null;
  openFeeUsd: number | null;
  autopilotSessionId?: string | null;
};

export function buildFlashTailMeta(args: BuildArgs): FlashTailMeta {
  return {
    sourceType: "flash-tail",
    venue: "flash",
    sourceKind: args.lineage.sourceKind,
    whaleId: args.lineage.whaleId,
    botId: args.lineage.botId,
    sourceName: args.lineage.sourceName,
    sourcePositionId: args.lineage.sourcePositionId,
    autopilotSessionId: args.autopilotSessionId ?? null,
    market: args.market,
    side: args.side,
    leverage: args.leverage,
    mode: args.mode,
    walletAddress: args.walletAddress,
    entryPriceUsd: args.entryPriceUsd,
    notionalUsd: args.notionalUsd,
    openFeeUsd: args.openFeeUsd,
    openSignature: null,
    closeSignature: null,
    closeReason: null,
    proceedsSource: null,
    reconciledAt: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isSide(value: unknown): value is "long" | "short" {
  return value === "long" || value === "short";
}

/** Parse the optional `tail` object from the /api/flash/perp request body. */
export function parseTailLineage(value: unknown): TailLineage | null {
  if (!isRecord(value)) return null;
  if (
    value.sourceKind !== "whale" &&
    value.sourceKind !== "bot" &&
    value.sourceKind !== "autopilot"
  ) {
    return null;
  }
  const whaleId = isString(value.whaleId) ? value.whaleId : null;
  const botId = isString(value.botId) ? value.botId : null;
  if (value.sourceKind === "whale" && !whaleId) return null;
  if (value.sourceKind === "bot" && !botId) return null;
  return {
    sourceKind: value.sourceKind,
    whaleId,
    botId,
    sourceName: isString(value.sourceName) ? value.sourceName : null,
    sourcePositionId: isString(value.sourcePositionId)
      ? value.sourcePositionId
      : null,
  };
}

export function parseFlashTailMeta(value: unknown): FlashTailMeta | null {
  if (!isRecord(value)) return null;
  if (value.sourceType !== "flash-tail" || value.venue !== "flash") return null;
  if (
    value.sourceKind !== "whale" &&
    value.sourceKind !== "bot" &&
    value.sourceKind !== "autopilot"
  ) {
    return null;
  }
  if (!isStringOrNull(value.autopilotSessionId ?? null)) return null;
  if (!isStringOrNull(value.whaleId ?? null)) return null;
  if (!isStringOrNull(value.botId ?? null)) return null;
  if (!isString(value.market)) return null;
  if (!isSide(value.side)) return null;
  if (typeof value.leverage !== "number" || !Number.isFinite(value.leverage)) {
    return null;
  }
  if (value.mode !== "standard" && value.mode !== "degen") return null;
  if (!isString(value.walletAddress)) return null;
  if (!isNumberOrNull(value.entryPriceUsd ?? null)) return null;
  if (!isNumberOrNull(value.notionalUsd ?? null)) return null;
  if (!isNumberOrNull(value.openFeeUsd ?? null)) return null;
  if (!isStringOrNull(value.openSignature ?? null)) return null;
  if (!isStringOrNull(value.closeSignature ?? null)) return null;
  if (
    value.closeReason !== null &&
    value.closeReason !== "manual" &&
    value.closeReason !== "external"
  ) {
    return null;
  }
  if (
    value.proceedsSource !== null &&
    value.proceedsSource !== "quote-estimate" &&
    value.proceedsSource !== "chain"
  ) {
    return null;
  }
  if (!isStringOrNull(value.reconciledAt ?? null)) return null;

  return {
    sourceType: "flash-tail",
    venue: "flash",
    sourceKind: value.sourceKind,
    whaleId: (value.whaleId as string | null) ?? null,
    botId: (value.botId as string | null) ?? null,
    sourceName: isString(value.sourceName) ? value.sourceName : null,
    sourcePositionId: isString(value.sourcePositionId)
      ? value.sourcePositionId
      : null,
    autopilotSessionId: (value.autopilotSessionId as string | null) ?? null,
    market: value.market,
    side: value.side,
    leverage: value.leverage,
    mode: value.mode,
    walletAddress: value.walletAddress,
    entryPriceUsd: (value.entryPriceUsd as number | null) ?? null,
    notionalUsd: (value.notionalUsd as number | null) ?? null,
    openFeeUsd: (value.openFeeUsd as number | null) ?? null,
    openSignature: (value.openSignature as string | null) ?? null,
    closeSignature: (value.closeSignature as string | null) ?? null,
    closeReason: (value.closeReason as FlashTailMeta["closeReason"]) ?? null,
    proceedsSource:
      (value.proceedsSource as "quote-estimate" | "chain" | null) ?? null,
    reconciledAt: (value.reconciledAt as string | null) ?? null,
  };
}
