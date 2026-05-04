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
