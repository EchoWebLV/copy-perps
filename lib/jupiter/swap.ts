import { JUPITER_BASE, USDC_MINT, USDC_DECIMALS } from "./constants";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: bigint | number;
  slippageBps?: number;
}): Promise<JupiterQuote> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: (params.slippageBps ?? 100).toString(),
  });

  const res = await fetch(`${JUPITER_BASE}/swap/v1/quote?${qs}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Jupiter quote ${res.status}: ${txt}`);
  }
  return (await res.json()) as JupiterQuote;
}

export async function buildSwap(params: {
  quoteResponse: JupiterQuote;
  userPublicKey: string;
}): Promise<JupiterSwapResponse> {
  const res = await fetch(`${JUPITER_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: "high", maxLamports: 1_000_000 } },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Jupiter swap ${res.status}: ${txt}`);
  }
  return (await res.json()) as JupiterSwapResponse;
}

export async function buyTokenWithUsdc(params: {
  outputMint: string;
  usdcDollars: number;
  userPublicKey: string;
  slippageBps?: number;
}) {
  const inAmount = BigInt(Math.floor(params.usdcDollars * 10 ** USDC_DECIMALS));
  const quote = await getQuote({
    inputMint: USDC_MINT,
    outputMint: params.outputMint,
    amount: inAmount,
    slippageBps: params.slippageBps,
  });
  const swap = await buildSwap({
    quoteResponse: quote,
    userPublicKey: params.userPublicKey,
  });
  return { quote, swap };
}

export async function sellTokenForUsdc(params: {
  inputMint: string;
  tokenAmountAtomic: bigint;
  userPublicKey: string;
  slippageBps?: number;
}) {
  const quote = await getQuote({
    inputMint: params.inputMint,
    outputMint: USDC_MINT,
    amount: params.tokenAmountAtomic,
    slippageBps: params.slippageBps,
  });
  const swap = await buildSwap({
    quoteResponse: quote,
    userPublicKey: params.userPublicKey,
  });
  return { quote, swap };
}
