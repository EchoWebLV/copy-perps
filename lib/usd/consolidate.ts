import {
  getUsdcBalance,
  getJupUsdBalance,
  getSolBalance,
} from "@/lib/solana/balance";
import {
  buildSwapInstructions,
  buildSwapTx,
  getQuote,
  sellTokenForUsdc,
} from "@/lib/jupiter/swap";
import { JUPUSD_MINT, USDC_MINT } from "@/lib/jupiter/constants";
import {
  buildUserSolDripIx,
  gasWalletPubkey,
  partialSignAsFeePayer,
} from "@/lib/wallets/gas";
import { PublicKey } from "@solana/web3.js";

// Minimum SOL we require in the user's wallet before letting them open
// any position. Covers tx fees + ATA rent + Flash position account
// rent. Flash's swapAndOpen + Jupiter Prediction's createOrder both
// allocate fresh accounts mid-tx; without ~0.01 SOL of headroom they
// fail with "insufficient lamports" or "Insufficient SOL or token
// balance" — which is what users see as a generic "insufficient funds"
// error.
const MIN_SOL_FOR_BET = 0.01;

export class InsufficientSolForFeesError extends Error {
  constructor(public solBalance: number) {
    super(
      `Need at least ${MIN_SOL_FOR_BET} SOL for fees and account rent — you have ${solBalance.toFixed(
        4,
      )} SOL. Add a tiny bit more SOL and try again.`,
    );
    this.name = "InsufficientSolForFeesError";
  }
}

// Read SOL balance and throw the friendly error if it's below the
// per-bet floor. Call this at the top of every bet route — it catches
// the failure before the on-chain simulation does, so the message the
// user sees actually says "you're low on SOL" instead of a generic
// program error.
export async function requireSolForBet(userPubkey: string): Promise<void> {
  const sol = await getSolBalance(userPubkey);
  if (sol < MIN_SOL_FOR_BET) {
    throw new InsufficientSolForFeesError(sol);
  }
}

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

// Gasless variant: returns a base64 versioned tx where Gas Wallet is
// the fee payer. Tx is partial-signed by Gas Wallet; caller just needs
// the user's signature.
export async function ensureUsdcOrConsolidateGasless(params: {
  userPubkey: string;
  requiredUsd: number;
}): Promise<ConsolidationResult> {
  const [usdcBalance, jupUsdBalance] = await Promise.all([
    getUsdcBalance(params.userPubkey),
    getJupUsdBalance(params.userPubkey),
  ]);

  console.log(
    `[consolidate-gasless] required=$${params.requiredUsd} usdc=$${usdcBalance.toFixed(4)} jupUsd=$${jupUsdBalance.toFixed(4)}`,
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
  const swapInputAtomic = BigInt(Math.ceil(shortfall * 1.02 * 1_000_000));

  const quote = await getQuote({
    inputMint: JUPUSD_MINT,
    outputMint: USDC_MINT,
    amount: swapInputAtomic,
    slippageBps: 50,
  });
  const ixResp = await buildSwapInstructions({
    quoteResponse: quote,
    userPublicKey: params.userPubkey,
  });
  const dripIx = buildUserSolDripIx({
    userPubkey: new PublicKey(params.userPubkey),
    numAtasToFund: ixResp.setupInstructions.length,
  });
  const tx = await buildSwapTx({
    ixResp,
    feePayer: gasWalletPubkey,
    prependInstructions: dripIx ? [dripIx] : [],
    appendInstructions: [],
  });
  partialSignAsFeePayer(tx);

  return {
    ready: false,
    consolidationTransaction: Buffer.from(tx.serialize()).toString("base64"),
    requiredUsd: params.requiredUsd,
    usdcBalance,
    jupUsdBalance,
  };
}
