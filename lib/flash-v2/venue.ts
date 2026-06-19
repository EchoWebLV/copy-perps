import { postBuilder as defaultPostBuilder } from "./builder";
import { buildOnboardingSteps } from "./onboard";
import { getPositions, getPrices, getMarkets, getBasketPubkey } from "./query";
import type { OnboardStep, Quote, Side, OrderType, UnsignedTx } from "./types";

type PostBuilder = typeof defaultPostBuilder;

export interface OpenArgs {
  owner: string;
  symbol: string;
  collateralUsd: number;
  leverage: number;
  side: Side;
  orderType: OrderType;
  takeProfit?: number;
  stopLoss?: number;
}
export interface CloseArgs {
  owner: string;
  symbol: string;
  side: Side;
  closeUsd: number;
}

/**
 * Map the raw /transaction-builder/open-position response onto the normalized
 * Quote. The live response keys are `newEntryPrice` / `newLiquidationPrice` /
 * `entryFee` (NOT the snapshot's *Ui names) plus the `youRecieveUsdUi` typo,
 * kept verbatim. A blind `raw as Quote` cast would silently read undefined.
 * Spellings are documented but not byte-confirmed — re-verify against
 * openapi.v2.json / the devnet smoke before trusting them in the UI.
 */
function rawToQuote(raw: Record<string, unknown>): Quote {
  const num = (v: unknown): number | undefined =>
    v === undefined || v === null ? undefined : Number(v);
  return {
    entryPriceUi: num(raw.newEntryPrice),
    liquidationPriceUi: num(raw.newLiquidationPrice),
    feeUsdUi: num(raw.entryFee),
    youPayUsdUi: num(raw.youPayUsdUi) ?? null,
    youRecieveUsdUi: num(raw.youRecieveUsdUi) ?? null,
  };
}

/** User-signed Flash v2 venue (Phase 1). Session-key/server-driven copy = Phase 2. */
export function flashV2Venue(deps: { postBuilder?: PostBuilder } = {}) {
  const post = deps.postBuilder ?? defaultPostBuilder;

  return {
    async ensureOnboarded(owner: string): Promise<OnboardStep[]> {
      const basket = await getBasketPubkey(owner);
      if (basket) return [];
      return buildOnboardingSteps(owner, { postBuilder: post });
    },

    async deposit(args: { owner: string; amountUsdc: number; tokenMint: string }): Promise<UnsignedTx> {
      const { tx } = await post("/transaction-builder/deposit-direct", {
        owner: args.owner,
        tokenMint: args.tokenMint,
        amount: String(args.amountUsdc),
      });
      return { tx, layer: "base" };
    },

    async openPosition(args: OpenArgs): Promise<{ unsigned: UnsignedTx; quote: Quote }> {
      const body: Record<string, unknown> = {
        owner: args.owner,
        inputTokenSymbol: "USDC",
        outputTokenSymbol: args.symbol,
        inputAmountUi: args.collateralUsd,
        leverage: args.leverage,
        tradeType: args.side === "long" ? "LONG" : "SHORT",
        orderType: args.orderType.toUpperCase(),
      };
      if (args.takeProfit != null) body.takeProfit = args.takeProfit;
      if (args.stopLoss != null) body.stopLoss = args.stopLoss;
      const { tx, raw } = await post("/transaction-builder/open-position", body);
      return { unsigned: { tx, layer: "er" }, quote: rawToQuote(raw) };
    },

    async closePosition(args: CloseArgs): Promise<{ unsigned: UnsignedTx }> {
      const { tx } = await post("/transaction-builder/close-position", {
        owner: args.owner,
        marketSymbol: args.symbol,
        side: args.side === "long" ? "LONG" : "SHORT",
        inputUsdUi: args.closeUsd,
        withdrawTokenSymbol: "USDC",
      });
      return { unsigned: { tx, layer: "er" } };
    },

    getPositions,
    getMarks: getPrices,
    getMarkets,
  };
}

export type FlashV2Venue = ReturnType<typeof flashV2Venue>;
