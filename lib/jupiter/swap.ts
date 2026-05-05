import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection } from "@/lib/solana/balance";
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
  maxAccounts?: number;
}): Promise<JupiterQuote> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: (params.slippageBps ?? 100).toString(),
  });
  if (params.maxAccounts) qs.set("maxAccounts", params.maxAccounts.toString());

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
  useSharedAccounts?: boolean;
}): Promise<JupiterSwapResponse> {
  const res = await fetch(`${JUPITER_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      useSharedAccounts: params.useSharedAccounts ?? true,
      // Privy's signer can't resolve address-lookup-table contents on its
      // own, so request a legacy (non-versioned) tx without ALT references.
      // For straightforward swaps this still fits well under Solana's
      // 1232-byte cap.
      // Versioned tx with ALTs. Client uses signTransaction + a Helius
      // connection to submit so ALTs resolve correctly server-side.
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
  useSharedAccounts?: boolean;
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
    useSharedAccounts: params.useSharedAccounts,
  });
  return { quote, swap };
}

interface JupIxJson {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export interface JupiterSwapInstructionsResponse {
  computeBudgetInstructions: JupIxJson[];
  setupInstructions: JupIxJson[];
  swapInstruction: JupIxJson;
  cleanupInstruction: JupIxJson | null;
  addressLookupTableAddresses: string[];
}

export async function buildSwapInstructions(params: {
  quoteResponse: JupiterQuote;
  userPublicKey: string;
  // Default Jupiter behavior wraps routes through "shared accounts" —
  // a single output token account reused across hops. Efficient, but
  // strict about min-out and trips 0x1788 (SlippageToleranceExceeded)
  // for low-liquidity tokens like jupUSD even with generous slippage.
  // Set to false to force the plain Route path which is more forgiving.
  useSharedAccounts?: boolean;
}): Promise<JupiterSwapInstructionsResponse> {
  const res = await fetch(`${JUPITER_BASE}/swap/v1/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      useSharedAccounts: params.useSharedAccounts ?? true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: "high",
          maxLamports: 1_000_000,
        },
      },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Jupiter swap-instructions ${res.status}: ${txt}`);
  }
  return (await res.json()) as JupiterSwapInstructionsResponse;
}

function decodeJupIx(ix: JupIxJson): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

// Build a versioned tx from a Jupiter swap-instructions response, with
// `feePayer` paying the SOL and optional `prependInstructions` /
// `appendInstructions` slotted around Jupiter's ixs.
//   - prependInstructions go BEFORE Jupiter's setupInstructions: use this
//     for SOL drips so the user has lamports for ATA rent before the
//     create-ATA setup ix runs.
//   - appendInstructions go AFTER cleanupInstruction: use this for the
//     Treasury fee transfer (USDC must already be in user's ATA).
// Caller is responsible for partial-signing as the fee payer before
// returning to the client.
export async function buildSwapTx(params: {
  ixResp: JupiterSwapInstructionsResponse;
  feePayer: PublicKey;
  appendInstructions: TransactionInstruction[];
  prependInstructions?: TransactionInstruction[];
}): Promise<VersionedTransaction> {
  const conn = getConnection();
  const altAccounts: AddressLookupTableAccount[] = [];
  for (const addr of params.ixResp.addressLookupTableAddresses) {
    const r = await conn.getAddressLookupTable(new PublicKey(addr));
    if (!r.value) throw new Error(`ALT not found: ${addr}`);
    altAccounts.push(r.value);
  }

  const ixs: TransactionInstruction[] = [
    ...params.ixResp.computeBudgetInstructions.map(decodeJupIx),
    ...(params.prependInstructions ?? []),
    ...params.ixResp.setupInstructions.map(decodeJupIx),
    decodeJupIx(params.ixResp.swapInstruction),
    ...(params.ixResp.cleanupInstruction
      ? [decodeJupIx(params.ixResp.cleanupInstruction)]
      : []),
    ...params.appendInstructions,
  ];

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: params.feePayer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(altAccounts);

  return new VersionedTransaction(message);
}
