import type {
  PacificaAccountInfo,
  PacificaLeaderboardEntry,
  PacificaMarketInfo,
  PacificaOrderFill,
  PacificaPosition,
  PacificaPositionHistoryRow,
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

type PacificaSignature =
  | string
  | {
      type: "hardware";
      value: string;
    };

async function getEnvelope<T>(path: string, attempt = 0): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  // Pacifica rate-limits unauthed reads. Honor Retry-After when present,
  // otherwise back off exponentially. Up to 4 attempts (~7s total).
  if (r.status === 429 && attempt < 3) {
    const retryAfterHeader = r.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Math.max(250, Number(retryAfterHeader) * 1000)
      : 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
    await new Promise((res) => setTimeout(res, retryAfterMs));
    return getEnvelope<T>(path, attempt + 1);
  }
  const j = (await r.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!r.ok || !j || !j.success || j.data === null) {
    const errMsg = j?.error ?? `HTTP ${r.status}`;
    throw new Error(`Pacifica GET ${path} failed: ${errMsg}`);
  }
  return j.data;
}

function postErrorMessage<R>(
  path: string,
  status: number,
  env: ApiEnvelope<R> | null,
  rawText: string,
): string {
  const bodyMsg =
    env?.error ??
    (rawText.trim().length > 0 ? rawText.trim().slice(0, 300) : null);
  return `Pacifica POST ${path} failed: ${bodyMsg ?? `HTTP ${status}`}`;
}

function parseEnvelope<R>(rawText: string): ApiEnvelope<R> | null {
  if (!rawText) return null;
  try {
    return JSON.parse(rawText) as ApiEnvelope<R>;
  } catch {
    return null;
  }
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
  return getEnvelope<PacificaAccountInfo>(`/account?account=${account}`);
}

// Per-fill history with realized PnL per row. Used to compute win
// streak + 1d win rate during refresh-traders. Note: many fills can
// belong to one order — caller groups by order_id when needed.
export async function getPositionsHistory(
  account: string,
  limit = 100,
): Promise<PacificaPositionHistoryRow[]> {
  return getEnvelope<PacificaPositionHistoryRow[]>(
    `/positions/history?account=${account}&limit=${limit}`,
  );
}

// Generic signed POST. Caller provides the already-signed message
// envelope (built via lib/pacifica/sign.ts). Returns the typed response
// payload or throws.
export async function postSigned<P, R>(
  path: string,
  signed: {
    account: string;
    agentWallet?: string;
    signatureB58: PacificaSignature;
    header: SignatureHeader;
    payload: P;
  },
  options: { allowNullData?: boolean } = {},
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
  const rawText = await r.text().catch(() => "");
  const env = parseEnvelope<R>(rawText);
  if (!r.ok || !env || !env.success || (!options.allowNullData && env.data === null)) {
    throw new Error(postErrorMessage(path, r.status, env, rawText));
  }
  return env.data as R;
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
  signatureB58: PacificaSignature;
  header: SignatureHeader;
  payload: { agent_wallet: string };
}): Promise<{ ok: boolean }> {
  await postSigned("/agent/bind", signed, { allowNullData: true });
  return { ok: true };
}
