import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  buildDepositTx,
  InsufficientWalletUsdcError,
} from "@/lib/pacifica/deposit";
import { PACIFICA_MIN_DEPOSIT_USDC } from "@/lib/bets/funding";
import {
  ensureGasWalletReady,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";
import { getFlashV2Venue } from "@/lib/flash-v2/resolve";
import { planFlashV2Deposit } from "@/lib/flash-v2/deposit-flow";
import { FLASH_V2_USDC_MINT } from "@/lib/flash-v2/constants";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  amountUsdc?: number;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.amountUsdc || body.amountUsdc < PACIFICA_MIN_DEPOSIT_USDC) {
    return NextResponse.json(
      { error: `amountUsdc >= ${PACIFICA_MIN_DEPOSIT_USDC} required` },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  // Flash v2 funding (flag-gated): onboard the basket first if needed, then
  // deposit. Base-layer + user-signed, so no Gas Wallet. Pacifica path below is
  // untouched when the flag is off.
  const flashV2 = getFlashV2Venue();
  if (flashV2) {
    const plan = await planFlashV2Deposit({
      venue: flashV2,
      owner: user.solanaPubkey,
      amountUsdc: body.amountUsdc,
      tokenMint: FLASH_V2_USDC_MINT,
    });
    return NextResponse.json(plan);
  }

  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  let tx;
  try {
    tx = await buildDepositTx({
      userPubkey: new PublicKey(user.solanaPubkey),
      amountUsdc: body.amountUsdc,
    });
  } catch (err) {
    if (err instanceof InsufficientWalletUsdcError) {
      const additionalUsdc = Math.max(0, err.requiredUsdc - err.walletUsdc);
      return NextResponse.json(
        { error: `Add $${additionalUsdc.toFixed(2)} more USDC to trade.` },
        { status: 400 },
      );
    }
    throw err;
  }
  return NextResponse.json({ depositTransaction: tx.transactionB64 });
}
