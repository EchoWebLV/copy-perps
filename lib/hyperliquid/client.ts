const BASE = "https://api.hyperliquid.xyz/info";

export interface HLPosition {
  coin: string;
  szi: string; // signed; negative = short
  leverage: { type: string; value: number };
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
}

export interface HLAssetPosition {
  type: string;
  position: HLPosition;
}

export interface HLClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary?: HLClearinghouseState["marginSummary"];
  assetPositions: HLAssetPosition[];
  withdrawable: string;
  time: number;
}

export async function getClearinghouseState(
  user: string,
): Promise<HLClearinghouseState> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user }),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Hyperliquid clearinghouseState ${r.status}: ${txt}`);
  }
  return (await r.json()) as HLClearinghouseState;
}

export async function getAllMids(): Promise<Record<string, string>> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids" }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Hyperliquid allMids ${r.status}`);
  return (await r.json()) as Record<string, string>;
}

// Hyperliquid fill direction strings. "Long > Short" (and vice-versa) are
// flips — the fill closes the prior direction AND opens the opposite.
export type HLFillDir =
  | "Open Long"
  | "Open Short"
  | "Close Long"
  | "Close Short"
  | "Long > Short"
  | "Short > Long"
  | "Liquidated Long"
  | "Liquidated Short";

export interface HLFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  dir: HLFillDir | string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
}

export async function getUserFillsByTime(
  user: string,
  startTimeMs: number,
): Promise<HLFill[]> {
  const r = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "userFillsByTime",
      user,
      startTime: startTimeMs,
    }),
    cache: "no-store",
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Hyperliquid userFillsByTime ${r.status}: ${txt}`);
  }
  return (await r.json()) as HLFill[];
}
