import { PublicKey } from "@solana/web3.js";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import { getAccountInfo } from "@/lib/pacifica/client";
import { getConnection } from "@/lib/solana/balance";
import { USDC_MINT } from "@/lib/jupiter/constants";

const PACIFICA_TAKER_FEE_BPS = 4;
const OPEN_ORDER_BUFFER_USDC = 0.1;
const PACIFICA_PROGRAM_ID = "PCFA5iYgmqK6MqPhWNKg7Yv7auX7VZ4Cx7T1eJyrAMH";
const RECENT_DEPOSIT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function roundUpCents(value: number): number {
  if (value <= 0) return 0;
  return Math.ceil((value - 1e-9) * 100) / 100;
}

export function requiredPacificaCollateralUsdc(params: {
  stakeUsdc: number;
  leverage: number;
}): number {
  const stake = Math.max(0, params.stakeUsdc);
  const leverage = Math.max(1, params.leverage);
  const openingFee = stake * leverage * (PACIFICA_TAKER_FEE_BPS / 10_000);
  return roundUpCents(stake + openingFee + OPEN_ORDER_BUFFER_USDC);
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
  return roundUpCents(Math.max(0, required - available));
}

export function recentDepositCoversRequired(params: {
  recentDepositUsdc: number;
  requiredUsdc: number;
}): boolean {
  return params.recentDepositUsdc + 0.000001 >= params.requiredUsdc;
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

export async function getPacificaAvailableToSpendUsdc(
  account: string,
): Promise<number | null> {
  try {
    const info = await getAccountInfo(account);
    const available = Number(info.available_to_spend);
    return Number.isFinite(available) ? Math.max(0, available) : 0;
  } catch (err) {
    if (/account not found/i.test(String(err))) return null;
    throw err;
  }
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
  const availablePacificaUsdc = await getPacificaAvailableToSpendUsdc(
    params.userMainPubkey,
  );
  const requiredUsdc = requiredPacificaCollateralUsdc({
    stakeUsdc: params.stakeUsdc,
    leverage: params.leverage,
  });
  if (availablePacificaUsdc === null) {
    const recentDepositUsdc = await getRecentPacificaDepositUsdc(
      params.userMainPubkey,
    );
    if (
      recentDepositCoversRequired({
        recentDepositUsdc,
        requiredUsdc,
      })
    ) {
      return null;
    }
  }
  const topUpUsdc = pacificaDepositTopUpUsdc({
    availableToSpendUsdc: availablePacificaUsdc ?? 0,
    stakeUsdc: params.stakeUsdc,
    leverage: params.leverage,
  });
  if (topUpUsdc <= 0) return null;

  const { transactionB64 } = await buildDepositTx({
    userPubkey: new PublicKey(params.userMainPubkey),
    amountUsdc: topUpUsdc,
  });
  return {
    depositTransactionB64: transactionB64,
    initialDepositUsdc: topUpUsdc,
    availablePacificaUsdc: availablePacificaUsdc ?? 0,
  };
}
