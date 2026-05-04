// Logos bundled in /public/perps/. Hyperliquid lists hundreds of perps
// but we only ship icons for the highest-volume ones. Anything not in
// this map renders the gradient fallback in WhaleCard.
const PERP_ICONS: Record<string, string> = {
  BTC: "/perps/btc.svg",
  ETH: "/perps/eth.svg",
  SOL: "/perps/sol.svg",
  DOGE: "/perps/doge.svg",
  AVAX: "/perps/avax.svg",
  LINK: "/perps/link.svg",
  MATIC: "/perps/matic.svg",
  POL: "/perps/matic.svg",
  SUI: "/perps/sui.png",
  ARB: "/perps/arb.png",
  OP: "/perps/op.png",
};

export function perpAssetImage(asset: string): string | null {
  return PERP_ICONS[asset.toUpperCase()] ?? null;
}
