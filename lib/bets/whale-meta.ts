export type WhaleCopyMeta = {
  sourceType: "whale";
  whaleId: string;
  source: "pacifica" | "hyperliquid";
  sourceAccount: string;
  sourcePositionId: string;
  leaderMarket: string;
  leaderSide: "long" | "short";
  leverage: number;
  autoCloseOnSourceClose: boolean;
  userEntryPrice: number;
  sourceEntryPriceAtCopy: number;
  pacificaOrderId: string;
  closeReason: "manual" | "source_closed" | "already_flat" | null;
};

type BuildWhaleCopyMetaArgs = Omit<WhaleCopyMeta, "sourceType" | "closeReason">;

export function buildWhaleCopyMeta(args: BuildWhaleCopyMetaArgs): WhaleCopyMeta {
  return {
    sourceType: "whale",
    ...args,
    closeReason: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWhaleSource(value: unknown): value is WhaleCopyMeta["source"] {
  return value === "pacifica" || value === "hyperliquid";
}

function isWhaleCloseReason(
  value: unknown,
): value is WhaleCopyMeta["closeReason"] {
  return (
    value === null ||
    value === "manual" ||
    value === "source_closed" ||
    value === "already_flat"
  );
}

export function parseWhaleCopyMeta(value: unknown): WhaleCopyMeta | null {
  if (!isRecord(value)) return null;
  if (value.sourceType !== "whale") return null;
  if (!isString(value.whaleId)) return null;
  if (!isWhaleSource(value.source)) return null;
  if (!isString(value.sourceAccount)) return null;
  if (!isString(value.sourcePositionId)) return null;
  if (!isString(value.leaderMarket)) return null;
  if (value.leaderSide !== "long" && value.leaderSide !== "short") return null;
  if (!isNumber(value.leverage)) return null;
  if (typeof value.autoCloseOnSourceClose !== "boolean") return null;
  if (!isNumber(value.userEntryPrice)) return null;
  if (!isNumber(value.sourceEntryPriceAtCopy)) return null;
  if (!isString(value.pacificaOrderId)) return null;
  if (!isWhaleCloseReason(value.closeReason)) return null;

  return {
    sourceType: "whale",
    whaleId: value.whaleId,
    source: value.source,
    sourceAccount: value.sourceAccount,
    sourcePositionId: value.sourcePositionId,
    leaderMarket: value.leaderMarket,
    leaderSide: value.leaderSide,
    leverage: value.leverage,
    autoCloseOnSourceClose: value.autoCloseOnSourceClose,
    userEntryPrice: value.userEntryPrice,
    sourceEntryPriceAtCopy: value.sourceEntryPriceAtCopy,
    pacificaOrderId: value.pacificaOrderId,
    closeReason: value.closeReason,
  };
}
