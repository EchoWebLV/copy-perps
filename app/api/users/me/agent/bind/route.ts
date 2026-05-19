import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { bindAgentWallet } from "@/lib/pacifica/client";
import { finalizeAgentBind } from "@/lib/bets/onboard";
import { buildMessage, verifySig } from "@/lib/pacifica/sign";

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

  const header = {
    type: "bind_agent_wallet",
    timestamp: body.timestamp,
    expiry_window: body.expiryWindow,
  };
  const payload = { agent_wallet: body.agentPubkey };
  const bindMessage = buildMessage(header, payload);
  const locallyValid = await verifySig(
    bindMessage,
    body.signatureB58,
    user.solanaPubkey,
  ).catch(() => false);
  try {
    await bindAgentWallet({
      account: user.solanaPubkey,
      // Browser wallets commonly sign Solana messages with the off-chain
      // message prefix. Pacifica accepts those as hardware-style
      // signatures; raw signatures stay as plain strings.
      signatureB58: locallyValid
        ? body.signatureB58
        : { type: "hardware", value: body.signatureB58 },
      header,
      payload,
    });
  } catch (err) {
    const msg = String(err);
    // If Pacifica reports the agent is already bound, a prior attempt
    // landed on their side but we never stamped bound_at locally —
    // recover by finalizing instead of failing the user.
    if (!/already/i.test(msg)) {
      console.error("[agent/bind] Pacifica rejected:", err);
      return NextResponse.json(
        { error: `Pacifica bind failed: ${msg}` },
        { status: 502 },
      );
    }
    console.warn("[agent/bind] agent already bound on Pacifica — finalizing");
  }

  const persisted = await finalizeAgentBind({
    userId: user.id,
    agentPubkey: body.agentPubkey,
  });
  return NextResponse.json({ ok: true, persisted });
}
