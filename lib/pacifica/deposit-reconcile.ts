import { PublicKey } from "@solana/web3.js";
import { getAccountBalanceHistory } from "@/lib/pacifica/client";
import { USDC_MINT } from "@/lib/jupiter/constants";
import { getConnection } from "@/lib/solana/balance";
import { getAssociatedTokenAddress } from "@/lib/solana/spl";

const PACIFICA_PROGRAM_ID = "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH";
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MATCH_WINDOW_MS = 10 * 60 * 1000;
const USDC_EPSILON = 0.000001;

export interface UncreditedPacificaDeposit {
  amountUsdc: number;
  signature: string;
  createdAt: string;
}

function keyAt(tx: unknown, index: number): string | null {
  const keys =
    (tx as { transaction?: { message?: { accountKeys?: unknown[] } } })
      ?.transaction?.message?.accountKeys ?? [];
  const key = keys[index] as
    | { pubkey?: { toBase58?: () => string }; toBase58?: () => string }
    | undefined;
  return key?.pubkey?.toBase58?.() ?? key?.toBase58?.() ?? null;
}

function mentionsPacificaProgram(tx: unknown): boolean {
  const keys =
    (tx as { transaction?: { message?: { accountKeys?: unknown[] } } })
      ?.transaction?.message?.accountKeys ?? [];
  return keys.some((key) => {
    const value =
      (key as { pubkey?: { toBase58?: () => string }; toBase58?: () => string })
        ?.pubkey?.toBase58?.() ??
      (key as { toBase58?: () => string })?.toBase58?.();
    return value === PACIFICA_PROGRAM_ID;
  });
}

function usdcDeltaForOwner(params: {
  tx: unknown;
  account: string;
  usdcAta: string;
}): number {
  const meta = (params.tx as { meta?: Record<string, unknown> }).meta;
  const preBalances =
    (meta?.preTokenBalances as
      | Array<{
          accountIndex: number;
          mint: string;
          owner?: string;
          uiTokenAmount?: { amount?: string };
        }>
      | undefined) ?? [];
  const postBalances =
    (meta?.postTokenBalances as
      | Array<{
          accountIndex: number;
          mint: string;
          owner?: string;
          uiTokenAmount?: { amount?: string };
        }>
      | undefined) ?? [];
  const postByIndex = new Map(
    postBalances
      .filter((balance) => balance.mint === USDC_MINT)
      .map((balance) => [balance.accountIndex, balance]),
  );

  let preAtomic = 0n;
  let postAtomic = 0n;
  for (const pre of preBalances) {
    if (pre.mint !== USDC_MINT) continue;
    const post = postByIndex.get(pre.accountIndex);
    const owner = pre.owner ?? post?.owner;
    const accountKey = keyAt(params.tx, pre.accountIndex);
    if (owner !== params.account && accountKey !== params.usdcAta) continue;
    preAtomic += BigInt(pre.uiTokenAmount?.amount ?? "0");
    postAtomic += BigInt(post?.uiTokenAmount?.amount ?? "0");
  }

  return Number(postAtomic - preAtomic) / 1_000_000;
}

function sameDeposit(
  onChain: UncreditedPacificaDeposit,
  history: { amountUsdc: number; createdAtMs: number },
): boolean {
  return (
    Math.abs(onChain.amountUsdc - history.amountUsdc) <= USDC_EPSILON &&
    Math.abs(Date.parse(onChain.createdAt) - history.createdAtMs) <=
      MATCH_WINDOW_MS
  );
}

export async function findUncreditedPacificaDeposits(params: {
  account: string;
  nowMs?: number;
  lookbackMs?: number;
}): Promise<{
  totalUsdc: number;
  deposits: UncreditedPacificaDeposit[];
}> {
  const nowMs = params.nowMs ?? Date.now();
  const cutoffMs = nowMs - (params.lookbackMs ?? DEFAULT_LOOKBACK_MS);
  const owner = new PublicKey(params.account);
  const usdcAta = getAssociatedTokenAddress(owner, new PublicKey(USDC_MINT));
  const conn = getConnection();

  const [signatures, balanceHistory] = await Promise.all([
    conn.getSignaturesForAddress(owner, { limit: 40 }, "confirmed"),
    getAccountBalanceHistory(params.account, 100),
  ]);

  const recordedDeposits = balanceHistory
    .filter((row) => /deposit/i.test(row.event_type))
    .map((row) => ({
      amountUsdc: Number(row.amount),
      createdAtMs: Number(row.created_at),
      matched: false,
    }))
    .filter(
      (row) =>
        Number.isFinite(row.amountUsdc) && Number.isFinite(row.createdAtMs),
    );

  const onChainDeposits: UncreditedPacificaDeposit[] = [];
  for (const signature of signatures) {
    if (
      signature.err ||
      !signature.blockTime ||
      signature.blockTime * 1000 < cutoffMs
    ) {
      continue;
    }
    const tx = await conn.getParsedTransaction(signature.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx || !mentionsPacificaProgram(tx)) continue;
    const delta = usdcDeltaForOwner({
      tx,
      account: params.account,
      usdcAta: usdcAta.toBase58(),
    });
    if (delta >= -USDC_EPSILON) continue;
    onChainDeposits.push({
      amountUsdc: Math.abs(delta),
      signature: signature.signature,
      createdAt: new Date(signature.blockTime * 1000).toISOString(),
    });
  }

  const uncredited = onChainDeposits.filter((deposit) => {
    const match = recordedDeposits.find(
      (row) => !row.matched && sameDeposit(deposit, row),
    );
    if (!match) return true;
    match.matched = true;
    return false;
  });

  return {
    totalUsdc:
      Math.round(
        uncredited.reduce((sum, deposit) => sum + deposit.amountUsdc, 0) *
          1_000_000,
      ) / 1_000_000,
    deposits: uncredited,
  };
}
