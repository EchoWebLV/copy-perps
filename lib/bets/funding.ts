import { PublicKey } from "@solana/web3.js";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import { getAccountInfo } from "@/lib/pacifica/client";

const PACIFICA_TAKER_FEE_BPS = 4;
const OPEN_ORDER_BUFFER_USDC = 0.1;

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

export async function getPacificaAvailableToSpendUsdc(
  account: string,
): Promise<number> {
  try {
    const info = await getAccountInfo(account);
    const available = Number(info.available_to_spend);
    return Number.isFinite(available) ? Math.max(0, available) : 0;
  } catch (err) {
    if (/account not found/i.test(String(err))) return 0;
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
  const topUpUsdc = pacificaDepositTopUpUsdc({
    availableToSpendUsdc: availablePacificaUsdc,
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
    availablePacificaUsdc,
  };
}
