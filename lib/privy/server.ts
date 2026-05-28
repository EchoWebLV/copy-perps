import { PrivyClient } from "@privy-io/server-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = process.env.PRIVY_APP_SECRET;
const walletAuthorizationPrivateKey =
  process.env.PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY ??
  process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;

if (!appId || !appSecret) {
  throw new Error(
    "NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET must be set",
  );
}

export const privyServer = new PrivyClient(appId, appSecret, {
  walletApi: walletAuthorizationPrivateKey
    ? { authorizationPrivateKey: walletAuthorizationPrivateKey }
    : undefined,
});

export interface PrivyClaims {
  userId: string;
  appId: string;
  sessionId?: string;
}

export async function verifyPrivyRequest(
  request: Request,
): Promise<PrivyClaims | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const claims = await privyServer.verifyAuthToken(token);
    return {
      userId: claims.userId,
      appId: claims.appId,
      sessionId: claims.sessionId,
    };
  } catch (e) {
    console.error("[privy] verifyAuthToken failed:", e);
    return null;
  }
}
