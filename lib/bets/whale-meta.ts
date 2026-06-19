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
  detachedFromSource?: boolean;
  userEntryPrice: number | null;
  sourceEntryPriceAtCopy: number;
  // The Pacifica order id, or (venue:'flash-v2') the open tx signature.
  pacificaOrderId: string | number;
  closeReason: "manual" | "source_closed" | "already_flat" | null;
  // Execution venue. Omitted on legacy/Pacifica rows (read back as 'pacifica' by
  // copyMetaVenue); set to 'flash-v2' for session-signed Flash v2 whale tails.
  venue?: "pacifica" | "flash-v2";
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

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isStringOrNumber(value: unknown): value is string | number {
  return isString(value) || isNumber(value);
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
  if (
    value.detachedFromSource !== undefined &&
    typeof value.detachedFromSource !== "boolean"
  ) {
    return null;
  }
  if (!isNumberOrNull(value.userEntryPrice)) return null;
  if (!isNumber(value.sourceEntryPriceAtCopy)) return null;
  if (!isStringOrNumber(value.pacificaOrderId)) return null;
  if (!isWhaleCloseReason(value.closeReason)) return null;
  if (
    value.venue !== undefined &&
    value.venue !== "pacifica" &&
    value.venue !== "flash-v2"
  ) {
    return null;
  }

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
    detachedFromSource: value.detachedFromSource,
    userEntryPrice: value.userEntryPrice,
    sourceEntryPriceAtCopy: value.sourceEntryPriceAtCopy,
    pacificaOrderId: value.pacificaOrderId,
    closeReason: value.closeReason,
    ...(value.venue !== undefined ? { venue: value.venue } : {}),
  };
}
