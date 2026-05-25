import { NextResponse } from "next/server";
import { sellTokenForUsdc } from "@/lib/jupiter/swap";
import { JUPUSD_DECIMALS, JUPUSD_MINT } from "@/lib/jupiter/constants";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { getTokenAtomicBalance } from "@/lib/solana/balance";
import { ensureUser } from "@/lib/users/ensure";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  walletAddress?: string;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.walletAddress) {
    return NextResponse.json({ error: "walletAddress required" }, { status: 400 });
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  const walletAddress = user.solanaPubkey ?? body.walletAddress;
  const jupUsdAtomic = await getTokenAtomicBalance(walletAddress, JUPUSD_MINT);
  if (jupUsdAtomic <= 0n) {
    return NextResponse.json(
      { error: "No jupUSD balance to convert" },
      { status: 400 },
    );
  }

  const { quote, swap } = await sellTokenForUsdc({
    inputMint: JUPUSD_MINT,
    tokenAmountAtomic: jupUsdAtomic,
    userPublicKey: walletAddress,
    slippageBps: 500,
    useSharedAccounts: false,
  });

  if (
    typeof swap.swapTransaction !== "string" ||
    swap.swapTransaction.length === 0
  ) {
    return NextResponse.json(
      { error: "Jupiter returned no swap transaction" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    swapTransaction: swap.swapTransaction,
    jupUsdAmount: Number(jupUsdAtomic) / 10 ** JUPUSD_DECIMALS,
    expectedUsdcOut: Number(quote.outAmount) / 1_000_000,
  });
}
