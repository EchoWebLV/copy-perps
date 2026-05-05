# Gasless Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users trade on all three rails (meme, prediction, whale) and withdraw using only USDC — never needing SOL in their wallet — by having a server-controlled Gas Wallet pay all SOL fees, while a flat 0.5% + $0.05 USDC fee per bet flows to a Treasury Wallet to recoup costs and earn margin.

**Architecture:** A two-wallet pattern. Gas Wallet (SOL only, hot) signs as fee payer on every user transaction. Treasury Wallet (USDC) receives a fee-transfer instruction appended to each open. For Meme/Whale/Withdraw/Consolidate we control tx construction and just swap the `payerKey`. For Jupiter Prediction (whose tx we can't modify), an atomic "prefund" tx drips SOL from Gas Wallet → user and sweeps the USDC fee → Treasury, then the user's prediction tx pays itself out of that drip.

**Tech Stack:** Next.js App Router (Node.js runtime), `@solana/web3.js` v1, `@solana/spl-token` (already transitively available), Drizzle ORM + Neon HTTP, Privy embedded Solana wallet, Jupiter `/swap-instructions` API, Flash SDK, Jupiter Prediction REST.

**Verification model:** This codebase has no test runner (per CLAUDE.md). Each task verifies via:
- `npm run typecheck` (TS strict, must pass)
- `npm run lint` (Next ESLint, must pass)
- Where the change is user-visible, manual exercise of the flow in the browser against a `.env.local` that has the new env vars set.

**Rollout:** Per-route feature flag `FEATURE_GASLESS_BETS=true`. Every modified route keeps the old path and switches on the flag, until the final cleanup task removes the legacy code.

---

## Pre-flight: env vars

Before starting, generate the two new env vars locally and add to `.env.local` (don't commit):

```bash
# Generate Gas Wallet keypair (one-time)
node -e 'const { Keypair } = require("@solana/web3.js"); const bs58 = require("bs58").default ?? require("bs58"); const kp = Keypair.generate(); console.log("PUBKEY:", kp.publicKey.toBase58()); console.log("SECRET:", bs58.encode(kp.secretKey));'
```

Add to `.env.local`:
```
GAS_WALLET_PRIVATE_KEY=<base58 secret printed above>
TREASURY_PUBKEY=<paste any pubkey you control — for dev, use a wallet you can sweep from later>
FEATURE_GASLESS_BETS=true
```

Send the Gas Wallet pubkey ~0.1 SOL (mainnet, from Phantom or wherever) so it can pay fees during dev testing. The fee transfer to Treasury will lazy-create the USDC ATA on first use, so Treasury doesn't need pre-funding.

---

### Task 1: Gas Wallet keypair loader

**Files:**
- Create: `lib/wallets/gas.ts`

- [ ] **Step 1: Create `lib/wallets/gas.ts`**

```ts
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { getConnection } from "@/lib/solana/balance";

const secret = process.env.GAS_WALLET_PRIVATE_KEY;
if (!secret) {
  throw new Error("GAS_WALLET_PRIVATE_KEY is required");
}

export const gasWalletKeypair = Keypair.fromSecretKey(bs58.decode(secret));
export const gasWalletPubkey: PublicKey = gasWalletKeypair.publicKey;

// Per-request floor. If Gas Wallet is below this we refuse to build
// new bet txs — better than handing the client a tx that'll fail on
// submit. The operator-side refuel-trigger threshold lives in
// scripts/refuel-gas-wallet.mjs (1 SOL).
export const GAS_WALLET_MIN_BALANCE_SOL = 0.05;

export class GasWalletExhaustedError extends Error {
  constructor(public balance: number) {
    super(
      `Gas Wallet at ${balance.toFixed(4)} SOL — temporarily unable to open positions`,
    );
    this.name = "GasWalletExhaustedError";
  }
}

export async function ensureGasWalletReady(): Promise<void> {
  const conn = getConnection();
  const lamports = await conn.getBalance(gasWalletPubkey, "confirmed");
  const sol = lamports / 1_000_000_000;
  if (sol < GAS_WALLET_MIN_BALANCE_SOL) {
    throw new GasWalletExhaustedError(sol);
  }
}

// Adds Gas Wallet's signature at the fee-payer slot (index 0) of a
// VersionedTransaction. The user's signature is added on the client by
// Privy's signTransaction without overwriting this one.
export function partialSignAsFeePayer(tx: VersionedTransaction): void {
  tx.sign([gasWalletKeypair]);
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/wallets/gas.ts
git commit -m "Gas Wallet keypair loader + per-request preflight"
```

---

### Task 2: Treasury Wallet helpers + fee transfer ix builder

**Files:**
- Create: `lib/wallets/treasury.ts`

- [ ] **Step 1: Create `lib/wallets/treasury.ts`**

```ts
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";

const treasuryStr = process.env.TREASURY_PUBKEY;
if (!treasuryStr) {
  throw new Error("TREASURY_PUBKEY is required");
}

export const treasuryPubkey = new PublicKey(treasuryStr);
const usdcMintPk = new PublicKey(USDC_MINT);
const treasuryUsdcAta = getAssociatedTokenAddressSync(usdcMintPk, treasuryPubkey);

// Returns a pair of instructions:
//   1. Idempotent create of Treasury's USDC ATA (no-op after first call).
//   2. TransferChecked of `feeUsdcDollars` USDC from user's USDC ATA to
//      Treasury's USDC ATA. User must sign for the transfer.
//
// `feePayerForAta` is the wallet that pays rent for the create-ATA ix on
// first ever call. In our flow this is always the Gas Wallet (since
// it's the tx fee payer anyway).
export function buildFeeTransferInstructions(params: {
  userPubkey: PublicKey;
  feeUsdcDollars: number;
  feePayerForAta: PublicKey;
}): TransactionInstruction[] {
  const userUsdcAta = getAssociatedTokenAddressSync(usdcMintPk, params.userPubkey);
  const amountAtomic = BigInt(
    Math.ceil(params.feeUsdcDollars * 10 ** USDC_DECIMALS),
  );

  return [
    createAssociatedTokenAccountIdempotentInstruction(
      params.feePayerForAta,
      treasuryUsdcAta,
      treasuryPubkey,
      usdcMintPk,
    ),
    createTransferCheckedInstruction(
      userUsdcAta,
      usdcMintPk,
      treasuryUsdcAta,
      params.userPubkey,
      amountAtomic,
      USDC_DECIMALS,
    ),
  ];
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/wallets/treasury.ts
git commit -m "Treasury Wallet pubkey + fee-transfer ix builder"
```

---

### Task 3: Fee calculation pure function

**Files:**
- Create: `lib/fees/calc.ts`

- [ ] **Step 1: Create `lib/fees/calc.ts`**

```ts
// Per-bet fee model:
//   profit  = stake * 0.005   (the 0.5% margin)
//   sol_pt  = $0.05 flat      (covers SOL gas; subsidizes cold-start)
//   total   = profit + sol_pt
//
// Charged in USDC inside the same tx as the bet. Spec:
// docs/superpowers/specs/2026-05-05-gasless-trades-design.md
const PROFIT_BPS = 50;
const SOL_PASSTHROUGH_USD = 0.05;

export interface BetFee {
  profitUsdc: number;
  solPassthroughUsdc: number;
  totalFeeUsdc: number;
}

export function computeBetFee(stakeUsdc: number): BetFee {
  const profitUsdc = (stakeUsdc * PROFIT_BPS) / 10_000;
  return {
    profitUsdc,
    solPassthroughUsdc: SOL_PASSTHROUGH_USD,
    totalFeeUsdc: profitUsdc + SOL_PASSTHROUGH_USD,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/fees/calc.ts
git commit -m "Per-bet fee calc: 0.5% profit + \$0.05 SOL passthrough"
```

---

### Task 4: Add `feeUsdc` column to `bets`

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Read the current schema**

Read `lib/db/schema.ts` to find the `bets` table definition.

- [ ] **Step 2: Add `feeUsdc` column**

In the `bets` table definition, add a column next to `amountUsdc` (the stake column). Match the existing style — likely `numeric("fee_usdc", { precision: 20, scale: 6 })` if `amountUsdc` uses that, or `doublePrecision("fee_usdc")` if it uses that. Use the same type as `amountUsdc`.

Add it as nullable so existing rows backfill cleanly:

```ts
feeUsdc: numeric("fee_usdc", { precision: 20, scale: 6 }), // <-- match amountUsdc's type
```

(Or: if `amountUsdc` is `doublePrecision(...)`, use `doublePrecision("fee_usdc")`.)

- [ ] **Step 3: Push schema to dev DB**

Run: `npm run db:push`
Expected: drizzle-kit prints the diff and applies it. Confirm if prompted (Y).

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts
git commit -m "DB: add bets.fee_usdc column for gasless platform fee"
```

---

### Task 5: Jupiter `/swap-instructions` builder

**Files:**
- Modify: `lib/jupiter/swap.ts`

- [ ] **Step 1: Add new types and `buildSwapInstructions`**

Append to `lib/jupiter/swap.ts` (do NOT remove the existing `buildSwap`, `buyTokenWithUsdc`, `sellTokenForUsdc` — they stay for the legacy code path during rollout):

```ts
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { getConnection } from "@/lib/solana/balance";

interface JupIxJson {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
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
}): Promise<JupiterSwapInstructionsResponse> {
  const res = await fetch(`${JUPITER_BASE}/swap/v1/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { priorityLevel: "high", maxLamports: 1_000_000 },
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
// `feePayer` paying the SOL and `appendInstructions` (typically a fee
// transfer to Treasury) tacked on at the end. Caller is responsible for
// partial-signing as the fee payer before returning to the client.
export async function buildSwapTx(params: {
  ixResp: JupiterSwapInstructionsResponse;
  feePayer: PublicKey;
  appendInstructions: TransactionInstruction[];
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
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/jupiter/swap.ts
git commit -m "Jupiter: buildSwapInstructions + buildSwapTx (Gas Wallet as fee payer)"
```

---

### Task 6: Update `ensureUsdcOrConsolidate` to support gasless consolidation

**Files:**
- Modify: `lib/usd/consolidate.ts`

- [ ] **Step 1: Add gasless consolidation builder**

In `lib/usd/consolidate.ts`, add a new function next to `ensureUsdcOrConsolidate` (don't remove the existing one — both coexist during rollout):

```ts
import {
  buildSwapInstructions,
  buildSwapTx,
  getQuote,
} from "@/lib/jupiter/swap";
import { gasWalletPubkey, partialSignAsFeePayer } from "@/lib/wallets/gas";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/jupiter/constants";
import { PublicKey } from "@solana/web3.js";

// Gasless variant: returns a base64-encoded versioned tx where Gas
// Wallet is the fee payer. Tx is partial-signed by Gas Wallet; caller
// just needs the user's signature.
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
  const tx = await buildSwapTx({
    ixResp,
    feePayer: gasWalletPubkey,
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
```

(`USDC_DECIMALS` is unused in the new function — remove from the import line if your linter complains. Keep only the imports you actually reference.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/usd/consolidate.ts
git commit -m "Consolidation: gasless variant with Gas Wallet as fee payer"
```

---

### Task 7: Meme bet route — gasless path

**Files:**
- Modify: `app/api/bet/meme/route.ts`

- [ ] **Step 1: Add gasless branch**

At the top of `app/api/bet/meme/route.ts`, add new imports:

```ts
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { buildFeeTransferInstructions } from "@/lib/wallets/treasury";
import { computeBetFee } from "@/lib/fees/calc";
import {
  ensureUsdcOrConsolidateGasless,
} from "@/lib/usd/consolidate";
import {
  buildSwapInstructions,
  buildSwapTx,
  getQuote,
} from "@/lib/jupiter/swap";
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "@/lib/jupiter/constants";
```

Add a feature-flag check after parsing the body and validating the user (right before `requireSolForBet`):

```ts
const gasless = process.env.FEATURE_GASLESS_BETS === "true";
```

Replace the meme route body from line ~60 onward (the `requireSolForBet` block through the response) with this branch:

```ts
if (gasless) {
  // --- gasless path ---
  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const fee = computeBetFee(amount);
  const requiredUsd = amount + fee.totalFeeUsdc;

  try {
    const consolidation = await ensureUsdcOrConsolidateGasless({
      userPubkey: user.solanaPubkey,
      requiredUsd,
    });
    if (!consolidation.ready) {
      return NextResponse.json({
        phase: "consolidate",
        consolidationTransaction: consolidation.consolidationTransaction,
        usdcBalance: consolidation.usdcBalance,
        jupUsdBalance: consolidation.jupUsdBalance,
        requiredUsd: consolidation.requiredUsd,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientCombinedBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[bet/meme] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  // Build the USDC -> token swap with Gas Wallet as fee payer, with the
  // platform fee transfer appended to the same tx.
  const userPk = new PublicKey(user.solanaPubkey);
  const inAmount = BigInt(Math.floor(amount * 1_000_000));
  const quote = await getQuote({
    inputMint: USDC_MINT,
    outputMint: memePayload.tokenAddress,
    amount: inAmount,
  });
  const ixResp = await buildSwapInstructions({
    quoteResponse: quote,
    userPublicKey: user.solanaPubkey,
  });
  const feeIxs = buildFeeTransferInstructions({
    userPubkey: userPk,
    feeUsdcDollars: fee.totalFeeUsdc,
    feePayerForAta: gasWalletPubkey,
  });
  const tx = await buildSwapTx({
    ixResp,
    feePayer: gasWalletPubkey,
    appendInstructions: feeIxs,
  });
  partialSignAsFeePayer(tx);

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "meme",
      amountUsdc: amount,
      feeUsdc: fee.totalFeeUsdc.toString(),
      status: "pending",
      meta: {
        signalId: memePayload.id,
        tokenAddress: memePayload.tokenAddress,
        tokenSymbol: memePayload.ticker,
        tokenName: memePayload.name,
        entryPriceUsd: memePayload.price,
        expectedOutAmount: quote.outAmount,
        priceImpactPct: quote.priceImpactPct,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    swapTransaction: Buffer.from(tx.serialize()).toString("base64"),
    expectedOutAmount: quote.outAmount,
    priceImpactPct: quote.priceImpactPct,
  });
}

// --- legacy path (FEATURE_GASLESS_BETS=false) ---
// SOL preflight — Jupiter swap creates the destination token ATA inline...
[everything that was already there from `try { await requireSolForBet(...) }` to the end of the function]
```

(If `feeUsdc` is `numeric` in Drizzle, it accepts string per Drizzle convention. If it's `doublePrecision`, pass the number directly: `feeUsdc: fee.totalFeeUsdc`.)

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Smoke test (manual, dev server)**

```bash
npm run dev
```

In a separate browser window:
1. Sign in with Privy
2. Fund the Privy wallet with some USDC (mainnet, small amount — $5)
3. Tap a meme stake button at $5
4. Approve the wallet sign request
5. After landing, check Solscan: tx should have Gas Wallet at signer slot 0, the user as signer 1, a USDC transfer of $0.075 to Treasury at the end
6. Check the new bet row in `db:studio` — `feeUsdc` should be `0.075`

If signature verification or partial-sign behavior fails, see Risk note in spec under "Privy's `signTransaction` overwriting partial sigs."

- [ ] **Step 4: Commit**

```bash
git add app/api/bet/meme/route.ts
git commit -m "Bet/meme: gasless path behind FEATURE_GASLESS_BETS flag"
```

---

### Task 8: Flash perp builder — gasless variant

**Files:**
- Modify: `lib/flash-trade/perp.ts`

- [ ] **Step 1: Read current `buildOpenPerpTx`**

Read `lib/flash-trade/perp.ts` lines 52-177 to confirm structure.

- [ ] **Step 2: Add gasless params + fee-ix support to `buildOpenPerpTx`**

Add new optional fields to the params interface and use them when present. The change is minimal — `payerKey` and instruction list:

Replace the params type:

```ts
export async function buildOpenPerpTx(params: {
  userPubkey: PublicKey;
  asset: string;
  marketIndex: number;
  direction: "long" | "short";
  marginUsdc: number;
  whaleLeverage: number;
  // Gasless overrides — when both set, fee payer is the gas wallet,
  // appendInstructions are added before the message is compiled.
  gaslessFeePayer?: PublicKey;
  appendInstructions?: TransactionInstruction[];
}): Promise<BuildOpenPerpResult> {
```

Replace the `payerKey:` line:

```ts
const payerKey = params.gaslessFeePayer ?? params.userPubkey;
```

Replace the `ixs` array construction to include `appendInstructions`:

```ts
const ixs: TransactionInstruction[] = [
  cuLimit,
  cuPrice,
  ...backupOracleIxs,
  ...openData.instructions,
  ...(params.appendInstructions ?? []),
];
```

Replace the `TransactionMessage` call so it uses `payerKey`:

```ts
const message = new TransactionMessage({
  payerKey,
  recentBlockhash: blockhash,
  instructions: ixs,
}).compileToV0Message(altsResult.addressLookupTables);
```

Do the same in `buildClosePerpTx` (also accept `gaslessFeePayer?: PublicKey` and use it as `payerKey`; `appendInstructions` is not needed for close since closes don't charge a platform fee).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/flash-trade/perp.ts
git commit -m "Flash perp: optional gaslessFeePayer + appendInstructions params"
```

---

### Task 9: Perp bet route — gasless path

**Files:**
- Modify: `app/api/bet/perp/route.ts`

- [ ] **Step 1: Read current perp route**

Read `app/api/bet/perp/route.ts` to confirm structure.

- [ ] **Step 2: Add gasless branch**

At the top, add imports:

```ts
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { buildFeeTransferInstructions } from "@/lib/wallets/treasury";
import { computeBetFee } from "@/lib/fees/calc";
import { ensureUsdcOrConsolidateGasless } from "@/lib/usd/consolidate";
import { VersionedTransaction } from "@solana/web3.js";
```

After parsing & validation, before `requireSolForBet`:

```ts
const gasless = process.env.FEATURE_GASLESS_BETS === "true";
```

Replace the body from `requireSolForBet` onward with:

```ts
if (gasless) {
  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const fee = computeBetFee(marginUsdc);
  const requiredUsd = marginUsdc + fee.totalFeeUsdc;

  try {
    const consolidation = await ensureUsdcOrConsolidateGasless({
      userPubkey: user.solanaPubkey,
      requiredUsd,
    });
    if (!consolidation.ready) {
      return NextResponse.json({
        phase: "consolidate",
        consolidationTransaction: consolidation.consolidationTransaction,
        usdcBalance: consolidation.usdcBalance,
        jupUsdBalance: consolidation.jupUsdBalance,
        requiredUsd: consolidation.requiredUsd,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientCombinedBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[bet/perp] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const userPk = new PublicKey(user.solanaPubkey);
  const feeIxs = buildFeeTransferInstructions({
    userPubkey: userPk,
    feeUsdcDollars: fee.totalFeeUsdc,
    feePayerForAta: gasWalletPubkey,
  });

  const result = await buildOpenPerpTx({
    userPubkey: userPk,
    asset,
    marketIndex,
    direction,
    marginUsdc,
    whaleLeverage,
    gaslessFeePayer: gasWalletPubkey,
    appendInstructions: feeIxs,
  });

  // result.transaction is base64 of an unsigned VersionedTransaction; we
  // need to deserialize, partial-sign with Gas Wallet, and re-serialize.
  const txBytes = Buffer.from(result.transaction, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);
  partialSignAsFeePayer(tx);
  const signedTxB64 = Buffer.from(tx.serialize()).toString("base64");

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "whale",
      amountUsdc: marginUsdc,
      feeUsdc: fee.totalFeeUsdc.toString(),
      status: "pending",
      meta: {
        // ...existing meta keys (signalId, asset, direction, leverage, etc.) — copy from legacy branch
        flashAsset: asset,
        direction,
        leverage: whaleLeverage,
        marketIndex,
        baseAssetAmount: result.baseAssetAmount,
        notionalUsd: result.notionalUsd,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    swapTransaction: signedTxB64,
    isFirstTimeUser: result.isFirstTimeUser,
    notionalUsd: result.notionalUsd,
    baseAssetAmount: result.baseAssetAmount,
  });
}

// --- legacy path ---
[existing code preserved unchanged]
```

When copying `meta`, refer to the legacy branch's existing `meta` object and replicate its fields exactly so portfolio reads still work.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Smoke test**

In browser: tap a whale Tail/Fade button, sign, confirm landing on chain.

- [ ] **Step 5: Commit**

```bash
git add app/api/bet/perp/route.ts
git commit -m "Bet/perp: gasless path behind FEATURE_GASLESS_BETS flag"
```

---

### Task 10: Prediction bet route — atomic prefund

**Files:**
- Modify: `app/api/bet/prediction/route.ts`
- Modify: `lib/wallets/gas.ts` (add helper)

- [ ] **Step 1: Add prefund-tx builder helper to `lib/wallets/gas.ts`**

Append to `lib/wallets/gas.ts`:

```ts
import {
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import { getConnection as _conn } from "@/lib/solana/balance";

const PREFUND_TARGET_SOL = 0.005;
const PREFUND_SKIP_THRESHOLD_SOL = 0.005;

// Returns a base64 prefund tx (Gas Wallet as fee payer) when user's SOL
// is below threshold, or null when user already has enough SOL to pay
// for an upcoming Jupiter Prediction tx. The prefund includes the
// supplied `appendInstructions` (typically the Treasury fee transfer)
// so the fee is collected atomically in the same tx as the SOL drip.
export async function buildPredictionPrefundTx(params: {
  userPubkey: PublicKey;
  appendInstructions: TransactionInstruction[];
}): Promise<string> {
  const conn = _conn();
  const userLamports = await conn.getBalance(params.userPubkey, "confirmed");
  const userSol = userLamports / 1_000_000_000;

  const ixs: TransactionInstruction[] = [];
  if (userSol < PREFUND_SKIP_THRESHOLD_SOL) {
    const dripSol = PREFUND_TARGET_SOL - userSol;
    const dripLamports = Math.ceil(dripSol * 1_000_000_000);
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: gasWalletPubkey,
        toPubkey: params.userPubkey,
        lamports: dripLamports,
      }),
    );
  }
  ixs.push(...params.appendInstructions);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: gasWalletPubkey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  partialSignAsFeePayer(tx);
  return Buffer.from(tx.serialize()).toString("base64");
}
```

Note: the `TransactionInstruction` import is already in scope from earlier additions; if not, add it to the imports at the top of `lib/wallets/gas.ts`.

- [ ] **Step 2: Add gasless branch to prediction route**

At the top of `app/api/bet/prediction/route.ts`, add imports:

```ts
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  buildPredictionPrefundTx,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { buildFeeTransferInstructions } from "@/lib/wallets/treasury";
import { computeBetFee } from "@/lib/fees/calc";
import { ensureUsdcOrConsolidateGasless } from "@/lib/usd/consolidate";
import { PublicKey } from "@solana/web3.js";
```

After parsing & validation, before `requireSolForBet`:

```ts
const gasless = process.env.FEATURE_GASLESS_BETS === "true";
```

Replace from `requireSolForBet` onward with the gasless branch + a preserved legacy fallback. The gasless branch shape:

```ts
if (gasless) {
  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const fee = computeBetFee(amount);
  const requiredUsd = amount + fee.totalFeeUsdc;

  try {
    const consolidation = await ensureUsdcOrConsolidateGasless({
      userPubkey: user.solanaPubkey,
      requiredUsd,
    });
    if (!consolidation.ready) {
      return NextResponse.json({
        phase: "consolidate",
        consolidationTransaction: consolidation.consolidationTransaction,
        usdcBalance: consolidation.usdcBalance,
        jupUsdBalance: consolidation.jupUsdBalance,
        requiredUsd: consolidation.requiredUsd,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientCombinedBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[bet/prediction] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  // Build the unmodified Jupiter Prediction order tx (user as fee payer).
  const orderResp = await createOrder({
    ownerPubkey: user.solanaPubkey,
    marketId: predictionPayload.marketId,
    isYes,
    isBuy: true,
    depositAmountMicroUsd: BigInt(Math.floor(amount * 1_000_000)),
  });
  if (!orderResp.transaction) {
    return NextResponse.json(
      { error: "Jupiter Prediction returned no tx" },
      { status: 502 },
    );
  }

  // Build the prefund tx that drips SOL + sweeps the USDC fee.
  const userPk = new PublicKey(user.solanaPubkey);
  const feeIxs = buildFeeTransferInstructions({
    userPubkey: userPk,
    feeUsdcDollars: fee.totalFeeUsdc,
    feePayerForAta: gasWalletPubkey,
  });
  const prefundB64 = await buildPredictionPrefundTx({
    userPubkey: userPk,
    appendInstructions: feeIxs,
  });

  const [bet] = await db
    .insert(bets)
    .values({
      userId: user.id,
      type: "prediction",
      amountUsdc: amount,
      feeUsdc: fee.totalFeeUsdc.toString(),
      status: "pending",
      meta: {
        // Same fields as the legacy branch's prediction `meta` —
        // typically: marketId, isYes, contracts, externalOrderId,
        // newAvgPriceUsd, etc. Copy verbatim from existing code.
        marketId: predictionPayload.marketId,
        isYes,
        contracts: orderResp.order.contracts,
        externalOrderId: orderResp.externalOrderId,
        newAvgPriceUsd: orderResp.order.newAvgPriceUsd,
      },
    })
    .returning();

  return NextResponse.json({
    phase: "open",
    betId: bet.id,
    prefundTransaction: prefundB64,
    swapTransaction: orderResp.transaction,
  });
}

// --- legacy path ---
[existing code preserved unchanged]
```

(Match the existing legacy branch's `meta` keys exactly — read the legacy code and copy the field set.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/wallets/gas.ts app/api/bet/prediction/route.ts
git commit -m "Bet/prediction: gasless via atomic prefund (SOL drip + USDC fee in one tx)"
```

---

### Task 11: Client-side helper — handle prefund

**Files:**
- Modify: `lib/bets/post-with-consolidation.ts`

- [ ] **Step 1: Update `postBetWithConsolidation` to handle prefund**

Replace the existing `postBetWithConsolidation` function with a version that also signs+sends the prefund tx when present.

Add this branch INSIDE the existing loop, after the `data.phase === "consolidate"` block and BEFORE `return data`:

```ts
if (data.prefundTransaction && typeof data.prefundTransaction === "string") {
  // Prediction-rail atomic prefund: sign + submit the prefund tx
  // (drips SOL to user + sweeps USDC fee to Treasury), wait for
  // confirmation, then fall through to return `data` so the caller
  // signs + submits the actual prediction swap.
  const prefundBytes = decodeBase64Tx(
    data.prefundTransaction,
    "prefund tx",
  );
  const sig = await signAndSubmitTx(prefundBytes, wallet, signTransaction);
  const conn = new Connection(RPC_URL, "confirmed");
  const result = await conn.confirmTransaction(sig, "confirmed");
  if (result.value.err) {
    throw new Error(
      `Prefund tx failed on chain: ${JSON.stringify(result.value.err)}`,
    );
  }
  // Strip prefundTransaction from the returned shape so the caller
  // doesn't accidentally re-submit it.
  const { prefundTransaction: _drop, ...rest } = data;
  return rest;
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/bets/post-with-consolidation.ts
git commit -m "Client: postBetWithConsolidation handles prediction prefund tx"
```

---

### Task 12: Withdraw — gasless

**Files:**
- Modify: `app/api/withdraw/route.ts`

- [ ] **Step 1: Add gasless branch**

Read the current withdraw route to identify the consolidation step and the final SOL-paid USDC transfer.

At the top, add imports:

```ts
import {
  ensureGasWalletReady,
  gasWalletPubkey,
  partialSignAsFeePayer,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { ensureUsdcOrConsolidateGasless } from "@/lib/usd/consolidate";
```

After auth + validation, before `requireSolForBet`:

```ts
const gasless = process.env.FEATURE_GASLESS_BETS === "true";
```

Replace the body from `requireSolForBet` onward with:

```ts
if (gasless) {
  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  // Same consolidate-or-ready pattern as the bet routes, no platform fee.
  try {
    const consolidation = await ensureUsdcOrConsolidateGasless({
      userPubkey: user.solanaPubkey,
      requiredUsd: amount,
    });
    if (!consolidation.ready) {
      return NextResponse.json({
        phase: "consolidate",
        consolidationTransaction: consolidation.consolidationTransaction,
        usdcBalance: consolidation.usdcBalance,
        jupUsdBalance: consolidation.jupUsdBalance,
        requiredUsd: consolidation.requiredUsd,
      });
    }
  } catch (err) {
    if (err instanceof InsufficientCombinedBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[withdraw] consolidation check failed:", err);
    return NextResponse.json(
      { error: `Balance check failed: ${String(err)}` },
      { status: 502 },
    );
  }

  // Build USDC transfer with Gas Wallet as fee payer.
  // Reuse whatever the legacy code uses (createTransferCheckedInstruction
  // + getAssociatedTokenAddressSync) — just swap the feePayer at the
  // TransactionMessage call from senderPk to gasWalletPubkey.
  // ... (follow legacy code, replace `feePayer: senderPk` with
  // `feePayer: gasWalletPubkey`, then partialSignAsFeePayer(tx) before
  // serializing.)
  const tx = /* build the USDC transfer tx exactly as legacy does, but
    with payerKey: gasWalletPubkey */;
  partialSignAsFeePayer(tx);

  return NextResponse.json({
    phase: "withdraw",
    transaction: Buffer.from(tx.serialize()).toString("base64"),
  });
}

// --- legacy path ---
[unchanged existing code]
```

When implementing the actual tx build, copy the legacy code's instruction list exactly (compute budget ixs + `createTransferCheckedInstruction(...)`), and only change two things:
1. `payerKey: senderPk` → `payerKey: gasWalletPubkey`
2. After compiling, call `partialSignAsFeePayer(tx)` before serializing.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/withdraw/route.ts
git commit -m "Withdraw: gasless path (Gas Wallet pays fees, no platform fee)"
```

---

### Task 13: Close routes — gasless (no fee)

**Files:**
- Modify: `app/api/bet/meme/close/route.ts`
- Modify: `app/api/bet/prediction/close/route.ts`
- Modify: `app/api/bet/perp/close/route.ts`

Each close route currently builds a tx with the user as fee payer. We swap to Gas Wallet as fee payer, no other change.

- [ ] **Step 1: Read each close route**

Open each file and identify where the tx is built (look for `payerKey:` or where `buildSwap`, `buildClosePerpTx`, or `closePosition` is called).

- [ ] **Step 2: Update meme close**

In `app/api/bet/meme/close/route.ts`:
- Add the gasless feature-flag branch (same pattern as Task 7).
- In the gasless branch, build the USDC swap (token → USDC) using `buildSwapInstructions` + `buildSwapTx` with `feePayer: gasWalletPubkey`, no `appendInstructions`.
- Call `partialSignAsFeePayer(tx)`.
- Return base64.

- [ ] **Step 3: Update prediction close**

In `app/api/bet/prediction/close/route.ts`:
- Add the gasless flag branch.
- Jupiter Prediction's `closePosition` returns a baked tx with the user as fee payer. To make this gasless we apply the same atomic-prefund pattern — but with NO USDC fee (closes are free), so the prefund is just a SOL drip if needed. Use `buildPredictionPrefundTx({ userPubkey, appendInstructions: [] })`.
- Return both `prefundTransaction` (or null) and `swapTransaction` (the closePosition tx).

- [ ] **Step 4: Update perp close**

In `app/api/bet/perp/close/route.ts`:
- Add the gasless flag branch.
- Call `buildClosePerpTx({ ..., gaslessFeePayer: gasWalletPubkey })`.
- Deserialize `result.transaction`, `partialSignAsFeePayer(tx)`, re-serialize, return base64.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/bet/meme/close/route.ts app/api/bet/prediction/close/route.ts app/api/bet/perp/close/route.ts
git commit -m "Close routes: gasless path (no platform fee on closes)"
```

---

### Task 14: Refuel ops script

**Files:**
- Create: `scripts/refuel-gas-wallet.mjs`

- [ ] **Step 1: Create the script**

```js
// Usage: node --env-file=.env.local scripts/refuel-gas-wallet.mjs
//
// Manual operator script. Reads Gas Wallet's SOL balance; if below the
// refuel trigger, swaps a fixed amount of Treasury USDC -> SOL via
// Jupiter and transfers the resulting SOL to Gas Wallet.
//
// Treasury private key is required at runtime via TREASURY_PRIVATE_KEY
// env var (NOT stored in .env.local — paste at invocation time):
//   TREASURY_PRIVATE_KEY=<bs58> node --env-file=.env.local scripts/refuel-gas-wallet.mjs
//
// Confirms before signing.

import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createTransferInstruction } from "@solana/spl-token";
import bs58 from "bs58";
import readline from "node:readline";

const REFUEL_TRIGGER_SOL = 1.0;
const REFUEL_AMOUNT_USDC = 200;
const RPC = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
if (!RPC) throw new Error("NEXT_PUBLIC_HELIUS_RPC_URL is required");

const gasSecret = process.env.GAS_WALLET_PRIVATE_KEY;
if (!gasSecret) throw new Error("GAS_WALLET_PRIVATE_KEY is required");
const gasKp = Keypair.fromSecretKey(bs58.decode(gasSecret));

const treasurySecret = process.env.TREASURY_PRIVATE_KEY;
if (!treasurySecret) throw new Error("TREASURY_PRIVATE_KEY is required (paste at invocation; not stored)");
const treasuryKp = Keypair.fromSecretKey(bs58.decode(treasurySecret));

const conn = new Connection(RPC, "confirmed");

const lamports = await conn.getBalance(gasKp.publicKey, "confirmed");
const sol = lamports / 1_000_000_000;
console.log(`Gas Wallet balance: ${sol.toFixed(4)} SOL`);

if (sol >= REFUEL_TRIGGER_SOL) {
  console.log(`Above trigger (${REFUEL_TRIGGER_SOL} SOL); nothing to do.`);
  process.exit(0);
}

console.log(`Below trigger. Swap $${REFUEL_AMOUNT_USDC} USDC from Treasury -> SOL and transfer to Gas Wallet?`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const confirm = await new Promise((r) => rl.question("Type 'yes' to proceed: ", r));
rl.close();
if (confirm.trim() !== "yes") {
  console.log("Aborted.");
  process.exit(1);
}

// 1. Quote USDC -> SOL via Jupiter
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const wsolMint = "So11111111111111111111111111111111111111112";
const inAmount = REFUEL_AMOUNT_USDC * 1_000_000;

const quoteRes = await fetch(`https://lite-api.jup.ag/swap/v1/quote?inputMint=${usdcMint}&outputMint=${wsolMint}&amount=${inAmount}&slippageBps=50`);
if (!quoteRes.ok) throw new Error(`quote: ${quoteRes.status} ${await quoteRes.text()}`);
const quote = await quoteRes.json();
console.log(`Quote: ${REFUEL_AMOUNT_USDC} USDC -> ${(Number(quote.outAmount) / 1e9).toFixed(4)} SOL`);

// 2. Build swap tx (Treasury is both signer and fee payer here — Treasury holds the USDC)
const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: treasuryKp.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  }),
});
if (!swapRes.ok) throw new Error(`swap: ${swapRes.status} ${await swapRes.text()}`);
const { swapTransaction } = await swapRes.json();

const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
tx.sign([treasuryKp]);
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
console.log(`Swap submitted: ${sig}`);
await conn.confirmTransaction(sig, "confirmed");
console.log("Swap confirmed.");

// 3. Treasury now has the SOL. Transfer it to Gas Wallet (leave a small buffer).
const treasuryLamports = await conn.getBalance(treasuryKp.publicKey, "confirmed");
const transferLamports = treasuryLamports - 5_000_000; // keep 0.005 SOL float in Treasury
if (transferLamports <= 0) throw new Error("Treasury SOL too low after swap");

const { SystemProgram, TransactionMessage } = await import("@solana/web3.js");
const { blockhash } = await conn.getLatestBlockhash("confirmed");
const transferIx = SystemProgram.transfer({
  fromPubkey: treasuryKp.publicKey,
  toPubkey: gasKp.publicKey,
  lamports: transferLamports,
});
const message = new TransactionMessage({
  payerKey: treasuryKp.publicKey,
  recentBlockhash: blockhash,
  instructions: [transferIx],
}).compileToV0Message();
const transferTx = new VersionedTransaction(message);
transferTx.sign([treasuryKp]);
const transferSig = await conn.sendRawTransaction(transferTx.serialize());
console.log(`Transfer submitted: ${transferSig}`);
await conn.confirmTransaction(transferSig, "confirmed");
console.log(`Done. New Gas Wallet balance: ${((await conn.getBalance(gasKp.publicKey)) / 1e9).toFixed(4)} SOL`);
```

(`createTransferInstruction` import is unused after restructuring — remove if linter complains. Keep only what you reference.)

- [ ] **Step 2: Add to package.json**

Add to the `scripts` section in `package.json`:

```json
"refuel:gas": "node --env-file=.env.local scripts/refuel-gas-wallet.mjs"
```

- [ ] **Step 3: Verify (no execution)**

Run: `npm run typecheck && npm run lint`
Expected: clean. Do NOT run `npm run refuel:gas` unless Gas Wallet is genuinely below 1 SOL.

- [ ] **Step 4: Commit**

```bash
git add scripts/refuel-gas-wallet.mjs package.json
git commit -m "Ops: refuel-gas-wallet.mjs — Treasury USDC -> SOL -> Gas Wallet"
```

---

### Task 15: Cleanup — remove legacy `requireSolForBet` paths

**Files:**
- Modify: `lib/usd/consolidate.ts`
- Modify: `app/api/bet/meme/route.ts`
- Modify: `app/api/bet/prediction/route.ts`
- Modify: `app/api/bet/perp/route.ts`
- Modify: `app/api/withdraw/route.ts`
- Modify: `app/api/bet/meme/close/route.ts`
- Modify: `app/api/bet/prediction/close/route.ts`
- Modify: `app/api/bet/perp/close/route.ts`

**Important:** only do this task after the gasless flow has been smoke-tested in production with `FEATURE_GASLESS_BETS=true` for at least one full day across all three rails.

- [ ] **Step 1: Delete `requireSolForBet` and `InsufficientSolForFeesError`**

In `lib/usd/consolidate.ts`, delete:
- The `MIN_SOL_FOR_BET` constant
- The `InsufficientSolForFeesError` class
- The `requireSolForBet` function
- Any unused imports (`getSolBalance` if it's no longer referenced)

Also delete the legacy non-gasless `ensureUsdcOrConsolidate` IF it's no longer referenced. Check via grep.

- [ ] **Step 2: Remove the legacy branch in each route**

In each modified route, delete the `if (gasless)` check and the `else` branch (the legacy path), keeping only what was inside the gasless branch. Remove the `gasless` variable, the legacy `requireSolForBet` import + call, and any imports that only the legacy branch used.

Search-and-confirm: after deletion, `grep -rn "requireSolForBet\|FEATURE_GASLESS_BETS" --include="*.ts"` should produce no results.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Smoke test all three rails + withdraw**

In a browser session against production preview:
- Open + close a meme bet
- Open + close a prediction bet
- Open + close a perp bet
- Withdraw $5 USDC

Confirm none of them throw `InsufficientSolForFeesError` or any "low SOL" error.

- [ ] **Step 5: Commit**

```bash
git add lib/usd/consolidate.ts app/api/bet/meme/route.ts app/api/bet/prediction/route.ts app/api/bet/perp/route.ts app/api/withdraw/route.ts app/api/bet/meme/close/route.ts app/api/bet/prediction/close/route.ts app/api/bet/perp/close/route.ts
git commit -m "Remove legacy SOL-preflight code paths; gasless is now the only path"
```

---

### Task 16: Documentation updates

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `.env.example`**

Append to `.env.example`:

```
# Gas Wallet — pays SOL fees on all user txs (server fee-payer pattern).
# Generate with:
#   node -e 'const {Keypair} = require("@solana/web3.js"); const bs58 = require("bs58").default ?? require("bs58"); const kp = Keypair.generate(); console.log("PUBKEY:", kp.publicKey.toBase58()); console.log("SECRET:", bs58.encode(kp.secretKey));'
GAS_WALLET_PRIVATE_KEY=

# Treasury Wallet — receives USDC platform fees (0.5% + $0.05 per bet).
# Only the pubkey is needed by the app. The private key is only used by
# scripts/refuel-gas-wallet.mjs at op time.
TREASURY_PUBKEY=
```

Remove `FEATURE_GASLESS_BETS` references — the flag is gone after Task 15.

- [ ] **Step 2: Update `CLAUDE.md`**

In the "Architecture > USDC ↔ jupUSD consolidation" section, replace the `requireSolForBet` paragraph with a description of the gasless flow:

```md
### Gasless via server fee payer

Users only ever hold USDC. SOL fees on every user tx are paid by a
server-controlled **Gas Wallet** (`GAS_WALLET_PRIVATE_KEY`,
[lib/wallets/gas.ts](lib/wallets/gas.ts)) which is set as the fee payer
on every bet, close, withdraw, and consolidation tx. The user signs to
authorize their own USDC moving; their SOL balance is irrelevant.

A 0.5% + $0.05 platform fee per open is appended as a `TransferChecked`
USDC instruction inside the same tx, routed to a **Treasury Wallet**
(`TREASURY_PUBKEY`, [lib/wallets/treasury.ts](lib/wallets/treasury.ts)).
Closes and withdraws are free.

**Per-rail integration:**
- **Meme rail / consolidate**: Jupiter `/swap-instructions` API
  (returns ixs we compose ourselves), Gas Wallet as fee payer, fee ix
  appended.
- **Whale rail (Flash perp)**: Flash builds the tx, we set
  `gaslessFeePayer` and `appendInstructions` to inject Gas Wallet + fee
  ix. See [lib/flash-trade/perp.ts](lib/flash-trade/perp.ts).
- **Prediction rail (Jupiter Prediction)**: Their tx is baked with user
  as fee payer and can't be modified. We use an **atomic prefund**: a
  separate Gas Wallet → user SOL drip (~0.005 SOL) + USDC fee transfer
  in one tx, landed before the prediction tx. The prediction tx pays
  itself out of that drip. Position rent (~0.003 SOL) refunds back to
  the user on close, so warm subsequent prediction bets skip the drip.

**Operations:** [scripts/refuel-gas-wallet.mjs](scripts/refuel-gas-wallet.mjs)
swaps Treasury USDC → SOL via Jupiter and transfers to Gas Wallet when
its balance drops below ~1 SOL. Manual op for now (`npm run refuel:gas`).

**Spec:** [docs/superpowers/specs/2026-05-05-gasless-trades-design.md](docs/superpowers/specs/2026-05-05-gasless-trades-design.md).
```

In the "Bet lifecycle" section, update step 1 to mention Gas Wallet partial-sign:

> 1. **POST `/api/bet/{rail}`** — server validates, computes fee, runs balance preflight, builds the open tx with **Gas Wallet as fee payer + Treasury fee transfer ix appended**, partial-signs as fee payer, inserts a `bets` row with `status: 'pending'`, returns `{ phase: 'open', betId, swapTransaction }` (or `{ phase: 'consolidate', consolidationTransaction }`, or for prediction `{ phase: 'open', betId, prefundTransaction, swapTransaction }`).

In the "Environment" section, add the two new env vars to the required list:
- `GAS_WALLET_PRIVATE_KEY` — Gas Wallet keypair (base58); pays SOL fees on user txs.
- `TREASURY_PUBKEY` — Treasury Wallet pubkey; receives USDC platform fees.

- [ ] **Step 3: Verify**

Read CLAUDE.md and .env.example to sanity-check the wording and links.

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "Docs: gasless flow + Gas/Treasury wallet setup in CLAUDE.md and .env.example"
```

---

## Self-Review

After completing all tasks, this plan covers the spec sections:

1. **Two-wallet architecture** → Tasks 1, 2.
2. **Fee structure** → Task 3 (calc) + 7, 9, 10 (collection).
3. **Server fee-payer pattern** → Tasks 5, 8 (builders) + 7, 9, 10, 12, 13 (callers).
4. **Per-rail integration: meme / whale / consolidate** → Tasks 5, 6, 7, 8, 9.
5. **Per-rail integration: prediction (atomic prefund)** → Tasks 10, 11.
6. **Withdraw** → Task 12.
7. **Closes** → Task 13.
8. **Wallet refuel** → Task 14.
9. **Cleanup of legacy code** → Task 15.
10. **Docs** → Task 16.

**Failure modes addressed:**
- Gas Wallet runs dry → `ensureGasWalletReady()` in every route (Task 1, used in 7/9/10/12/13).
- Treasury USDC ATA missing → idempotent ATA-create ix in `buildFeeTransferInstructions` (Task 2).
- User cancels prediction prefund mid-flow → bet row reaper in `app/api/portfolio/route.ts` already handles abandoned pendings (no work; spec accepts the dropped fee for v1).
- Insufficient USDC after fee added → existing `InsufficientCombinedBalanceError` reused with new threshold.
- Privy `signTransaction` partial-sig overwrite → flagged in spec; Task 7 step 3 manual-test verifies on first end-to-end run.

**Plan complete and saved to `docs/superpowers/plans/2026-05-05-gasless-trades.md`.**
