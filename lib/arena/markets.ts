// lib/arena/markets.ts
//
// Single source of truth routing an arena asset to its on-chain market id +
// oracle feed PDA. The worker uses this to submit each decision action to the
// right market; the crank uses it to tick every active market; the brief uses
// assetForMarket() to label positions. Feeds are MagicBlock pricing_oracle
// Lazer PDAs (same mechanism as the SOL feed). Assets whose feed is still the
// UNSET placeholder are not yet stood up on-chain and are filtered by
// activeMarkets() (and would fail loudly if routed to).
import { PublicKey } from "@solana/web3.js";
import { ARENA_ASSETS, type ArenaAsset } from "./llm/schema";

// System program id == "not configured yet" sentinel (a later task replaces these).
const UNSET = new PublicKey("11111111111111111111111111111111");

const SOL_FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");

export interface MarketRoute {
  marketId: number;
  feed: PublicKey;
}

// marketId is FIXED per asset (it is an on-chain PDA seed; never renumber a
// live market). SOL=0 is the original live market.
export const ASSET_MARKETS: Record<ArenaAsset, MarketRoute> = {
  SOL: { marketId: 0, feed: SOL_FEED },
  BTC: { marketId: 1, feed: UNSET },
  ETH: { marketId: 2, feed: UNSET },
  BNB: { marketId: 3, feed: UNSET },
  XRP: { marketId: 4, feed: UNSET },
  DOGE: { marketId: 5, feed: UNSET },
};

const BY_MARKET: Record<number, ArenaAsset> = Object.fromEntries(
  ARENA_ASSETS.map((a) => [ASSET_MARKETS[a].marketId, a]),
) as Record<number, ArenaAsset>;

export function marketForAsset(asset: ArenaAsset): MarketRoute {
  return ASSET_MARKETS[asset];
}

export function assetForMarket(marketId: number): ArenaAsset | undefined {
  return BY_MARKET[marketId];
}

export function isFeedConfigured(asset: ArenaAsset): boolean {
  return !ASSET_MARKETS[asset].feed.equals(UNSET);
}

/** Markets that are actually stood up on-chain (feed configured). */
export function activeMarkets(): Array<{ asset: ArenaAsset } & MarketRoute> {
  return ARENA_ASSETS.filter(isFeedConfigured).map((asset) => ({
    asset,
    ...ASSET_MARKETS[asset],
  }));
}
