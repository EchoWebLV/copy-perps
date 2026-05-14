import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { buildDepositTx } from "@/lib/pacifica/deposit";
import {
  ensureGasWalletReady,
  GasWalletExhaustedError,
} from "@/lib/wallets/gas";

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
  if (!body?.amountUsdc || body.amountUsdc < 5) {
    return NextResponse.json(
      { error: "amountUsdc >= 5 required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    await ensureGasWalletReady();
  } catch (err) {
    if (err instanceof GasWalletExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const tx = await buildDepositTx({
    userPubkey: new PublicKey(user.solanaPubkey),
    amountUsdc: body.amountUsdc,
  });
  return NextResponse.json({ depositTransaction: tx.transactionB64 });
}
