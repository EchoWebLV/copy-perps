import { NextResponse } from "next/server";
import { Keypair } from "@solana/web3.js";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  FEATURE_FLASH_V2,
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
} from "@/lib/flash-v2/constants";
import { getConnection } from "@/lib/flash-v2/rpc";
import { buildCreateSessionTx, SessionAlreadyBoundError } from "@/lib/flash-v2/session";
import {
  generateSessionKeypair,
  createPendingSessionKey,
  getSessionStatus,
} from "@/lib/flash-v2/session-store";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface Body {
  walletAddress?: string;
}

/**
 * Read the user's session state for the standalone auto-copy toggle:
 * none | pending | active | expired (+ validUntil). Flash v2 only — 404 off.
 */
export async function GET(request: Request) {
  if (!FEATURE_FLASH_V2) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const claims = await verifyPrivyRequest(request);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await ensureUser(claims.userId, null);
  const status = await getSessionStatus(user.id);
  return NextResponse.json({
    state: status.state,
    sessionPubkey: status.sessionPubkey,
    validUntil: status.validUntil?.toISOString() ?? null,
  });
}

/**
 * Build a Flash v2 session-enable tx. The server generates the session signer,
 * persists it (pending, encrypted), and returns the createSessionV2 tx for the
 * user's wallet to sign (base layer). The client signs + submits, then POSTs
 * /session/confirm to flip it bound. Flash v2 only — 404 when the flag is off.
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

  const owner = user.solanaPubkey;
  const { publicKeyB58, seed } = generateSessionKeypair();
  const sessionSigner = Keypair.fromSeed(seed);
  // Clamp to the program's hard ceiling (now + 7d) as defense-in-depth. Today
  // the TTL is a fixed server constant with no client input, but a code-enforced
  // cap keeps a future configurable TTL from being rejected on-chain
  // (ValidityTooLong) instead of relying solely on the absent input path.
  const nowSec = Math.floor(Date.now() / 1000);
  const validUntilSec = Math.min(
    nowSec + DEFAULT_SESSION_TTL_SECONDS,
    nowSec + MAX_SESSION_TTL_SECONDS,
  );
  const validUntil = new Date(validUntilSec * 1000);

  const { tx, sessionToken } = await buildCreateSessionTx({
    authority: owner,
    sessionSigner,
    validUntilSec,
    connection: getConnection("base"),
  });

  try {
    await createPendingSessionKey({
      userId: user.id,
      mainPubkey: owner,
      sessionPubkey: publicKeyB58,
      sessionTokenPda: sessionToken,
      seed,
      validUntil,
    });
  } catch (err) {
    if (err instanceof SessionAlreadyBoundError) {
      return NextResponse.json(
        {
          error: "a session is already active — revoke it before enabling a new one",
          priorSessionPubkey: err.priorSessionPubkey,
          priorSessionToken: err.priorSessionTokenPda,
        },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    createSessionTransaction: tx
      .serialize({ requireAllSignatures: false })
      .toString("base64"),
    sessionPubkey: publicKeyB58,
    sessionToken,
    validUntil: validUntil.toISOString(),
  });
}
