import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { getAgentWallet } from "@/lib/wallets/agent";
import { requestWithdraw, getWithdrawable } from "@/lib/pacifica/withdraw";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Smallest withdraw we accept — also stops sub-cent amounts from rounding
// to "0" in the Pacifica payload.
const MIN_WITHDRAW_USDC = 0.01;

interface Body {
  amountUsdc?: number;
  walletAddress?: string;
}

// POST /api/withdraw/pacifica — pulls USDC out of the user's Pacifica
// account back to their own Solana wallet. The agent wallet signs the
// request server-side (no wallet modal); Pacifica settles to the account
// owner, so funds can only ever land in the user's own wallet.
export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const amount = body?.amountUsdc;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < MIN_WITHDRAW_USDC
  ) {
    return NextResponse.json(
      { error: `amountUsdc must be at least $${MIN_WITHDRAW_USDC}` },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body?.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  const agent = await getAgentWallet(user.id);
  if (!agent) {
    return NextResponse.json({ error: "no agent wallet bound" }, { status: 409 });
  }

  // Balance check and withdraw both target agent.mainPubkey — the Pacifica
  // account the agent is actually bound to and can sign for. (users.solanaPubkey
  // can drift from the frozen agent binding; never mix the two.)
  let withdrawable: number;
  try {
    withdrawable = await getWithdrawable(agent.mainPubkey);
  } catch (err) {
    return NextResponse.json(
      { error: `Pacifica account lookup failed: ${String(err)}` },
      { status: 502 },
    );
  }
  if (amount > withdrawable + 1e-6) {
    return NextResponse.json(
      {
        error: `amount exceeds withdrawable balance ($${withdrawable.toFixed(2)})`,
        withdrawable,
      },
      { status: 400 },
    );
  }

  try {
    const res = await requestWithdraw({ agent, amountUsdc: amount });
    // The signature `type` string is inferred — log the response envelope
    // so the first real withdrawals confirm it landed as expected.
    console.log("[withdraw/pacifica] ok:", JSON.stringify(res));
  } catch (err) {
    console.error("[withdraw/pacifica] failed:", err);
    return NextResponse.json(
      { error: `Pacifica withdraw failed: ${String(err)}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, amountUsdc: amount });
}

// GET /api/withdraw/pacifica — current withdrawable USDC balance, so the
// withdraw UI can show the max without the user attempting an overdraw.
export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await ensureUser(claims.userId, null);
  const agent = user.solanaPubkey ? await getAgentWallet(user.id) : null;
  if (!agent) return NextResponse.json({ withdrawable: 0 });

  try {
    const withdrawable = await getWithdrawable(agent.mainPubkey);
    return NextResponse.json({ withdrawable });
  } catch (err) {
    return NextResponse.json(
      { error: `Pacifica account lookup failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
