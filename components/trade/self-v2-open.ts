// components/trade/self-v2-open.ts
//
// Pure helpers for the flag-on (isFlashV2Client) self-directed Trade-tab path.
// The v2 open/close routes take a thinner body than v1 (no mode/instant) and the
// open response carries no position object, so the client synthesizes the
// FlashPosition it renders optimistically and lets the positions poll reconcile
// it by the deterministic flashv2:<market>:<side> key.
import { flashV2PositionKey } from "@/lib/flash-v2/self-position";

type Side = "long" | "short";

interface V2Quote {
  entryPriceUi?: number;
  liquidationPriceUi?: number;
  feeUsdUi?: number;
}

/** Body for POST /api/trade/perp (v2 self-directed open). */
export function buildSelfV2OpenBody(args: {
  market: string;
  side: Side;
  stakeUsdc: number;
  leverage: number;
  walletAddress: string | undefined;
}) {
  return {
    market: args.market,
    side: args.side,
    stakeUsdc: args.stakeUsdc,
    leverage: args.leverage,
    walletAddress: args.walletAddress,
  };
}

/** Body for POST /api/trade/perp/close (v2 self-directed close). */
export function buildSelfV2CloseBody(args: {
  market: string;
  side: Side;
  walletAddress: string | undefined;
}) {
  return {
    market: args.market,
    side: args.side,
    walletAddress: args.walletAddress,
  };
}

/**
 * Optimistic FlashPosition rendered right after a v2 open, before the positions
 * poll surfaces the real venue position. positionPubkey is the deterministic
 * flashv2:<market>:<side> key (matching the positions route) so the poll replaces
 * this entry by key instead of duplicating it. nowMs is injected for determinism.
 */
export function synthFlashV2Position(args: {
  market: string;
  side: Side;
  stakeUsdc: number;
  leverage: number;
  quote?: V2Quote | null;
  nowMs: number;
}) {
  const entry = args.quote?.entryPriceUi;
  return {
    symbol: args.market,
    side: args.side,
    positionPubkey: flashV2PositionKey(args.market, args.side),
    marketAccount: "",
    entryPriceUsd: typeof entry === "number" ? entry : 0,
    markPriceUsd: typeof entry === "number" ? entry : undefined,
    sizeUsd: args.stakeUsdc * args.leverage,
    collateralUsd: args.stakeUsdc,
    collateralSymbol: "USDC",
    leverage: args.leverage,
    liquidationPriceUsd: args.quote?.liquidationPriceUi,
    openFeeUsd: args.quote?.feeUsdUi,
    // The user's real stake. This is the highest-priority signal in
    // flashStakeUsdFromPosition, so the card reads ~$1 for a $1 open instead of
    // the sizeUsd/leverage fallback. That fallback misreads v2: the venue
    // reports a spread-reduced sizeUsd (~$18 for a $20 notional) and a broken
    // leverage field (Infinity), which divides out to the misleading ~$0.90.
    // It also rides the entry-cost cache onto the polled venue position so the
    // value stays stable after the optimistic synth is replaced.
    entryCostUsd: args.stakeUsdc,
    pnlUsd: 0,
    openTime: args.nowMs,
  };
}
