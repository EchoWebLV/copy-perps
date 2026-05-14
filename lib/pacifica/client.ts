import type {
  PacificaAccountInfo,
  PacificaLeaderboardEntry,
  PacificaMarketInfo,
  PacificaOrderFill,
  PacificaPosition,
} from "./types";
import type { SignatureHeader } from "./sign";

const BASE_URL =
  process.env.PACIFICA_REST_URL ?? "https://api.pacifica.fi/api/v1";

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  code: number | null;
}

async function getEnvelope<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const j = (await r.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!r.ok || !j || !j.success || j.data === null) {
    const errMsg = j?.error ?? `HTTP ${r.status}`;
    throw new Error(`Pacifica GET ${path} failed: ${errMsg}`);
  }
  return j.data;
}

export async function getMarkets(): Promise<PacificaMarketInfo[]> {
  // Pacifica's docs are inconsistent about the markets endpoint path
  // ("/info" in some versions, "/markets" in others). Try "/info" first
  // and fall back to "/markets" if it 404s.
  try {
    return await getEnvelope<PacificaMarketInfo[]>("/info");
  } catch (err) {
    if (String(err).includes("404") || String(err).includes("Not found")) {
      return getEnvelope<PacificaMarketInfo[]>("/markets");
    }
    throw err;
  }
}

export async function getLeaderboard(): Promise<PacificaLeaderboardEntry[]> {
  return getEnvelope<PacificaLeaderboardEntry[]>("/leaderboard");
}

export async function getPositions(account: string): Promise<PacificaPosition[]> {
  return getEnvelope<PacificaPosition[]>(`/positions?account=${account}`);
}

export async function getAccountInfo(account: string): Promise<PacificaAccountInfo> {
  return getEnvelope<PacificaAccountInfo>(`/account/info?account=${account}`);
}

// Generic signed POST. Caller provides the already-signed message
// envelope (built via lib/pacifica/sign.ts). Returns the typed response
// payload or throws.
export async function postSigned<P, R>(
  path: string,
  signed: {
    account: string;
    agentWallet?: string;
    signatureB58: string;
    header: SignatureHeader;
    payload: P;
  },
): Promise<R> {
  const body: Record<string, unknown> = {
    account: signed.account,
    signature: signed.signatureB58,
    timestamp: signed.header.timestamp,
    expiry_window: signed.header.expiry_window,
    ...(signed.payload as Record<string, unknown>),
  };
  if (signed.agentWallet) body.agent_wallet = signed.agentWallet;
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const env = (await r.json().catch(() => null)) as ApiEnvelope<R> | null;
  if (!r.ok || !env || !env.success || env.data === null) {
    const errMsg = env?.error ?? `HTTP ${r.status}`;
    throw new Error(`Pacifica POST ${path} failed: ${errMsg}`);
  }
  return env.data;
}

// Place a market order. Caller has already signed the payload with
// the appropriate keypair (agent for orders, main for bind).
export async function placeMarketOrder(signed: {
  account: string;
  agentWallet?: string;
  signatureB58: string;
  header: SignatureHeader;
  payload: {
    symbol: string;
    amount: string;
    side: "bid" | "ask";
    slippage_percent: string;
    reduce_only: boolean;
    client_order_id?: string;
  };
}): Promise<PacificaOrderFill> {
  return postSigned("/orders/create_market", signed);
}

export async function bindAgentWallet(signed: {
  account: string;
  signatureB58: string;
  header: SignatureHeader;
  payload: { agent_wallet: string };
}): Promise<{ ok: boolean }> {
  return postSigned("/agent/bind", signed);
}
