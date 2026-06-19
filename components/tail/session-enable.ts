import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { sendDepositWithSponsorFallback } from "./deposit-signing";

type SignAndSendTransaction = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  options?: { sponsor?: boolean };
}) => Promise<{ signature: Uint8Array | string }>;

export interface EnableSessionDeps {
  getAccessToken: () => Promise<string | null>;
  wallet: ConnectedStandardSolanaWallet;
  signAndSendTransaction: SignAndSendTransaction;
  /** Confirm the base-layer createSessionV2 signature on chain (injectable for tests). */
  confirm: (signature: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/** A prior bound session blocks creating a new one — the caller must revoke first. */
export class SessionAlreadyBoundClientError extends Error {
  constructor(
    public priorSessionPubkey: string | undefined,
    public priorSessionToken: string | undefined,
  ) {
    super("a session is already active — revoke it before enabling a new one");
    this.name = "SessionAlreadyBoundClientError";
  }
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function toBase58(signature: Uint8Array | string): Promise<string> {
  if (typeof signature === "string") return signature;
  return (await import("bs58")).default.encode(signature);
}

/**
 * Enable a Flash v2 trading session (the "auto-copy" key the server signs trades
 * with). Drives: POST /session (build, server-co-signed) → wallet signs the
 * base-layer createSessionV2 tx → on-chain confirm → POST /session/confirm
 * (flip bound_at). The tx is base-layer (no ALTs), so Privy's own submit works
 * — no sign-only/ER dance. Throws SessionAlreadyBoundClientError on a 409 so the
 * caller can route the user to revoke first.
 */
export async function enableFlashV2Session(
  deps: EnableSessionDeps,
): Promise<{ sessionPubkey: string; validUntil: string }> {
  const f = deps.fetchImpl ?? fetch;
  const token = await deps.getAccessToken();
  if (!token) throw new Error("not authed");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const buildResp = await f("/api/users/me/session", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ walletAddress: deps.wallet.address }),
  });
  const build = (await buildResp.json().catch(() => ({}))) as {
    createSessionTransaction?: string;
    sessionPubkey?: string;
    validUntil?: string;
    error?: string;
    priorSessionPubkey?: string;
    priorSessionToken?: string;
  };
  if (buildResp.status === 409) {
    throw new SessionAlreadyBoundClientError(
      build.priorSessionPubkey,
      build.priorSessionToken,
    );
  }
  if (!buildResp.ok || !build.createSessionTransaction || !build.sessionPubkey) {
    throw new Error(build.error ?? `could not start session (${buildResp.status})`);
  }

  const { signature } = await sendDepositWithSponsorFallback({
    transaction: b64ToBytes(build.createSessionTransaction),
    wallet: deps.wallet,
    signAndSendTransaction: deps.signAndSendTransaction,
    preferSponsored: false,
  });
  const sig = await toBase58(signature);
  await deps.confirm(sig);

  const confirmResp = await f("/api/users/me/session/confirm", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      sessionPubkey: build.sessionPubkey,
      walletAddress: deps.wallet.address,
    }),
  });
  if (!confirmResp.ok) {
    const e = (await confirmResp.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `could not confirm session (${confirmResp.status})`);
  }

  return { sessionPubkey: build.sessionPubkey, validUntil: build.validUntil ?? "" };
}
