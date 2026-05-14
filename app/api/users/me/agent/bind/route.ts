import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { bindAgentWallet } from "@/lib/pacifica/client";
import { finalizeAgentBind, clearPendingAgent } from "@/lib/bets/onboard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  agentPubkey?: string;
  signatureB58?: string;
  timestamp?: number;
  expiryWindow?: number;
  walletAddress?: string;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body?.agentPubkey || !body.signatureB58 || !body.timestamp || !body.expiryWindow) {
    return NextResponse.json(
      { error: "agentPubkey, signatureB58, timestamp, expiryWindow required" },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  try {
    await bindAgentWallet({
      account: user.solanaPubkey,
      signatureB58: body.signatureB58,
      header: {
        type: "bind_agent_wallet",
        timestamp: body.timestamp,
        expiry_window: body.expiryWindow,
      },
      payload: { agent_wallet: body.agentPubkey },
    });
  } catch (err) {
    clearPendingAgent(body.agentPubkey);
    console.error("[agent/bind] Pacifica rejected:", err);
    return NextResponse.json(
      { error: `Pacifica bind failed: ${String(err)}` },
      { status: 502 },
    );
  }

  const persisted = await finalizeAgentBind({ agentPubkey: body.agentPubkey });
  return NextResponse.json({ ok: true, persisted });
}
