import { getUsdcBalance, getJupUsdBalance } from "@/lib/solana/balance";
import { sellTokenForUsdc } from "@/lib/jupiter/swap";
import { JUPUSD_MINT } from "@/lib/jupiter/constants";

export interface ConsolidationResult {
  // True when user already has enough USDC and no swap is needed.
  ready: boolean;
  // Base64-encoded jupUSD->USDC swap transaction. Null when ready=true.
  consolidationTransaction: string | null;
  // Amount the user needs in USDC for the trade.
  requiredUsd: number;
  // What the user has on chain right now (UI dollars).
  usdcBalance: number;
  jupUsdBalance: number;
}

export class InsufficientCombinedBalanceError extends Error {
  constructor(
    public requiredUsd: number,
    public usdcBalance: number,
    public jupUsdBalance: number,
  ) {
    super(
      `Insufficient balance: need $${requiredUsd}, have $${usdcBalance.toFixed(
        2,
      )} USDC + $${jupUsdBalance.toFixed(2)} jupUSD`,
    );
    this.name = "InsufficientCombinedBalanceError";
  }
}

// If the user has < requiredUsd in USDC but their USDC + jupUSD covers
// it, build a Jupiter jupUSD->USDC swap for the shortfall (with a small
// buffer for stable-to-stable slippage). Used by perp/meme/prediction
// buy routes to seamlessly reach a single-mint state before the actual
// trade. Throws when even the combined balance falls short.
export async function ensureUsdcOrConsolidate(params: {
  userPubkey: string;
  requiredUsd: number;
}): Promise<ConsolidationResult> {
  const [usdcBalance, jupUsdBalance] = await Promise.all([
    getUsdcBalance(params.userPubkey),
    getJupUsdBalance(params.userPubkey),
  ]);

  console.log(
    `[consolidate] required=$${params.requiredUsd} usdc=$${usdcBalance.toFixed(4)} jupUsd=$${jupUsdBalance.toFixed(4)}`,
  );

  if (usdcBalance >= params.requiredUsd) {
    return {
      ready: true,
      consolidationTransaction: null,
      requiredUsd: params.requiredUsd,
      usdcBalance,
      jupUsdBalance,
    };
  }

  if (usdcBalance + jupUsdBalance < params.requiredUsd) {
    throw new InsufficientCombinedBalanceError(
      params.requiredUsd,
      usdcBalance,
      jupUsdBalance,
    );
  }

  const shortfall = params.requiredUsd - usdcBalance;
  // 2% over-swap buffer covers stable-to-stable slippage AND any
  // Jupiter Prediction fee that's deducted from the deposit at order
  // time. Without enough headroom, post-swap USDC sits right at the
  // required threshold and the prediction order rejects with
  // INSUFFICIENT_FUNDS even though the swap landed.
  const swapInputAtomic = BigInt(
    Math.ceil(shortfall * 1.02 * 1_000_000),
  );

  const { swap } = await sellTokenForUsdc({
    inputMint: JUPUSD_MINT,
    tokenAmountAtomic: swapInputAtomic,
    userPublicKey: params.userPubkey,
    slippageBps: 50,
  });

  if (typeof swap.swapTransaction !== "string" || swap.swapTransaction.length === 0) {
    throw new Error(
      `Jupiter jupUSD->USDC swap returned no transaction (got ${typeof swap.swapTransaction})`,
    );
  }

  return {
    ready: false,
    consolidationTransaction: swap.swapTransaction,
    requiredUsd: params.requiredUsd,
    usdcBalance,
    jupUsdBalance,
  };
}
