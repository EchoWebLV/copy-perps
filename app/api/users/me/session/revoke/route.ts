import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { FEATURE_FLASH_V2 } from "@/lib/flash-v2/constants";
import { getConnection } from "@/lib/flash-v2/rpc";
import { buildRevokeSessionTx } from "@/lib/flash-v2/session";
import {
  getSessionStatus,
  deleteSessionKey,
} from "@/lib/flash-v2/session-store";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  confirmed?: boolean;
  walletAddress?: string;
}

/**
 * Revoke the user's Flash v2 session (the standalone "turn off auto-copy"
 * action). Two phases on one route, mirroring enable:
 *  - build (no `confirmed`): returns the base-layer revokeSessionV2 tx for the
 *    user's wallet (authority) to sign. Only a BOUND session (active or expired)
 *    has an on-chain token to revoke; a pending/none session has nothing to sign.
 *  - confirm (`confirmed: true`): clears the row after the revoke landed, freeing
 *    the user to enable a fresh session.
 * Flash v2 only — 404 when the flag is off.
 */
export async function POST(request: Request) {
  if (!FEATURE_FLASH_V2) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const user = await ensureUser(claims.userId, body?.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  // Confirm phase: the on-chain revoke landed, so drop the row.
  if (body?.confirmed === true) {
    await deleteSessionKey(user.id);
    return NextResponse.json({ ok: true });
  }

  // Build phase: only a bound session (active/expired) has a token PDA to revoke.
  const status = await getSessionStatus(user.id);
  if (
    !status.sessionPubkey ||
    (status.state !== "active" && status.state !== "expired")
  ) {
    return NextResponse.json(
      { error: "no bound session to revoke" },
      { status: 404 },
    );
  }

  const tx = await buildRevokeSessionTx({
    authority: user.solanaPubkey,
    sessionSigner: status.sessionPubkey,
    connection: getConnection("base"),
  });
  return NextResponse.json({
    revokeTransaction: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
    sessionPubkey: status.sessionPubkey,
  });
}
