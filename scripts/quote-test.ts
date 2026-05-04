import { buyTokenWithUsdc } from "../lib/jupiter/swap";

const FAKE_PUBKEY = "11111111111111111111111111111111";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

(async () => {
  console.log("Quoting $1 USDC → WIF for", FAKE_PUBKEY);
  const r = await buyTokenWithUsdc({
    outputMint: WIF,
    usdcDollars: 1,
    userPublicKey: FAKE_PUBKEY,
  });
  console.log("  in:", r.quote.inAmount, "USDC atomic");
  console.log("  out:", r.quote.outAmount, "WIF atomic");
  console.log("  priceImpact:", r.quote.priceImpactPct + "%");
  console.log("  routes:", r.quote.routePlan.length);
  console.log(
    "  swap tx:",
    r.swap.swapTransaction.slice(0, 32) + "…",
    `(${r.swap.swapTransaction.length} chars base64)`,
  );
  console.log("  lastValidBlockHeight:", r.swap.lastValidBlockHeight);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
