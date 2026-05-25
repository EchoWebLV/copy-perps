import { PublicKey } from "@solana/web3.js";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import { getAccountInfo } from "@/lib/pacifica/client";
import { getConnection } from "@/lib/solana/balance";
import { USDC_MINT } from "@/lib/jupiter/constants";

export const PACIFICA_MIN_DEPOSIT_USDC = 10;
const PACIFICA_PROGRAM_ID = "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH";
const RECENT_DEPOSIT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CREDITED_EPSILON_USDC = 0.000001;

export class PacificaDepositPendingError extends Error {
  constructor(public recentDepositUsdc: number) {
    super(
      `Your ${recentDepositUsdc.toFixed(2)} USDC deposit landed on-chain, but Pacifica has not credited the account yet. Do not deposit again; wait for Pacifica support/credit before tailing.`,
    );
    this.name = "PacificaDepositPendingError";
  }
}

export class PacificaDepositSettlingError extends Error {
  retryAfterMs = 2000;

  constructor(public recentDepositUsdc: number) {
    super(
      `Your ${recentDepositUsdc.toFixed(2)} USDC deposit is confirmed on-chain; Pacifica is still crediting it. Waiting before opening the tail.`,
    );
    this.name = "PacificaDepositSettlingError";
  }
}

export class PacificaFundingRateLimitError extends Error {
  retryAfterMs = 5000;

  constructor(public cause: unknown) {
    super(
      "Pacifica is rate limiting balance checks. Waiting before retrying.",
    );
    this.name = "PacificaFundingRateLimitError";
  }
}

export function isPacificaFundingRateLimitError(err: unknown): boolean {
  if (err instanceof PacificaFundingRateLimitError) return true;
  return /Pacifica GET \/[^\s]+ failed: HTTP 429|HTTP 429|rate.?limit/i.test(
    String(err),
  );
}

function roundUpCents(value: number): number {
  if (value <= 0) return 0;
  return Math.ceil((value - 1e-9) * 100) / 100;
}

export function requiredPacificaCollateralUsdc(params: {
  stakeUsdc: number;
  leverage: number;
}): number {
  return roundUpCents(Math.max(0, params.stakeUsdc));
}

export function requiredPacificaDepositUsdc(params: {
  stakeUsdc: number;
  leverage: number;
}): number {
  return Math.max(PACIFICA_MIN_DEPOSIT_USDC, requiredPacificaCollateralUsdc(params));
}

export function pacificaDepositTopUpUsdc(params: {
  availableToSpendUsdc: number;
  stakeUsdc: number;
  leverage: number;
}): number {
  const available = Number.isFinite(params.availableToSpendUsdc)
    ? Math.max(0, params.availableToSpendUsdc)
    : 0;
  const required = requiredPacificaCollateralUsdc({
    stakeUsdc: params.stakeUsdc,
    leverage: params.leverage,
  });
  const shortfall = roundUpCents(Math.max(0, required - available));
  return shortfall > 0 ? Math.max(PACIFICA_MIN_DEPOSIT_USDC, shortfall) : 0;
}

export function classifyRecentPacificaDeposit(params: {
  recentDepositUsdc: number;
}): "none" | "below_minimum" | "settling" {
  if (params.recentDepositUsdc <= 0.000001) return "none";
  if (params.recentDepositUsdc + 0.000001 < PACIFICA_MIN_DEPOSIT_USDC) {
    return "below_minimum";
  }
  return "settling";
}

async function getRecentPacificaDepositUsdc(account: string): Promise<number> {
  const conn = getConnection();
  const owner = new PublicKey(account);
  const cutoffMs = Date.now() - RECENT_DEPOSIT_LOOKBACK_MS;
  const signatures = await conn.getSignaturesForAddress(
    owner,
    { limit: 20 },
    "confirmed",
  );
  let totalAtomic = 0;

  for (const sig of signatures) {
    if (sig.err || !sig.blockTime || sig.blockTime * 1000 < cutoffMs) {
      continue;
    }
    const tx = await conn.getParsedTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    const mentionsPacifica =
      tx?.transaction.message.accountKeys.some(
        (key) => key.pubkey.toBase58() === PACIFICA_PROGRAM_ID,
      ) ?? false;
    if (!mentionsPacifica || !tx?.meta) continue;

    const postByIndex = new Map(
      (tx.meta.postTokenBalances ?? []).map((balance) => [
        balance.accountIndex,
        balance,
      ]),
    );
    for (const pre of tx.meta.preTokenBalances ?? []) {
      if (pre.mint !== USDC_MINT || pre.owner !== account) continue;
      const post = postByIndex.get(pre.accountIndex);
      const preAtomic = Number(pre.uiTokenAmount.amount);
      const postAtomic = Number(post?.uiTokenAmount.amount ?? "0");
      if (preAtomic > postAtomic) {
        totalAtomic += preAtomic - postAtomic;
      }
    }
  }

  return totalAtomic / 1_000_000;
}

async function getPacificaFundingInfo(
  account: string,
): Promise<{
  availableToSpendUsdc: number;
  creditedUsdc: number;
} | null> {
  try {
    const info = await getAccountInfo(account);
    const available = Number(info.available_to_spend);
    const balance = Number(info.balance);
    const equity = Number(info.account_equity);
    const availableToSpendUsdc = Number.isFinite(available)
      ? Math.max(0, available)
      : 0;
    const creditedUsdc = Math.max(
      availableToSpendUsdc,
      Number.isFinite(balance) ? balance : 0,
      Number.isFinite(equity) ? equity : 0,
    );
    return {
      availableToSpendUsdc,
      creditedUsdc: Math.max(0, creditedUsdc),
    };
  } catch (err) {
    if (/account not found/i.test(String(err))) return null;
    if (isPacificaFundingRateLimitError(err)) {
      throw err instanceof PacificaFundingRateLimitError
        ? err
        : new PacificaFundingRateLimitError(err);
    }
    throw err;
  }
}

export async function getPacificaAvailableToSpendUsdc(
  account: string,
): Promise<number | null> {
  const info = await getPacificaFundingInfo(account);
  return info?.availableToSpendUsdc ?? null;
}

export async function planPacificaDepositTopUp(params: {
  userMainPubkey: string;
  stakeUsdc: number;
  leverage: number;
}): Promise<{
  depositTransactionB64: string;
  initialDepositUsdc: number;
  availablePacificaUsdc: number;
} | null> {
  const fundingInfo = await getPacificaFundingInfo(
    params.userMainPubkey,
  );
  const availablePacificaUsdc = fundingInfo?.availableToSpendUsdc ?? null;
  let recentDepositUsdc = 0;
  let recentDepositState:
    | ReturnType<typeof classifyRecentPacificaDeposit>
    | null = null;
  const loadRecentDepositState = async () => {
    if (recentDepositState !== null) return recentDepositState;
    recentDepositUsdc = await getRecentPacificaDepositUsdc(
      params.userMainPubkey,
    );
    recentDepositState = classifyRecentPacificaDeposit({
      recentDepositUsdc,
    });
    return recentDepositState;
  };
  const throwForRecentDepositState = (
    state: ReturnType<typeof classifyRecentPacificaDeposit>,
  ) => {
    if (state === "below_minimum") {
      throw new PacificaDepositPendingError(recentDepositUsdc);
    }
    if (state === "settling") {
      throw new PacificaDepositSettlingError(recentDepositUsdc);
    }
  };
  let availableForSizingUsdc = availablePacificaUsdc;
  if (availableForSizingUsdc === null) {
    throwForRecentDepositState(await loadRecentDepositState());
    availableForSizingUsdc = 0;
  }
  const topUpUsdc = pacificaDepositTopUpUsdc({
    availableToSpendUsdc: availableForSizingUsdc,
    stakeUsdc: params.stakeUsdc,
    leverage: params.leverage,
  });
  if (topUpUsdc <= 0) return null;
  if ((fundingInfo?.creditedUsdc ?? 0) <= CREDITED_EPSILON_USDC) {
    throwForRecentDepositState(await loadRecentDepositState());
  }

  const { transactionB64 } = await buildDepositTx({
    userPubkey: new PublicKey(params.userMainPubkey),
    amountUsdc: topUpUsdc,
  });
  return {
    depositTransactionB64: transactionB64,
    initialDepositUsdc: topUpUsdc,
    availablePacificaUsdc: availableForSizingUsdc,
  };
}
