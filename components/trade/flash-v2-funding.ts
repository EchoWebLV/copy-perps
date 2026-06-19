// components/trade/flash-v2-funding.ts
//
// Client orchestration for the v1-style ONE-TAP Flash v2 self-directed open. The
// server gates funding by returning discriminated phases; this driver signs the
// one-time setup transparently and re-calls until the session signs the open:
//
//   enable-session → onboard (sign base steps) → deposit → open (server-signed)
//
// All setup txs are base-layer + user-signed (sponsorship is off, decision #8);
// the actual trade is session-signed server-side (no popup). Kept framework-free
// (deps injected) so it is unit-testable without Privy/React.

export interface FundingHttp {
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface FundingActions {
  /** Sign + submit + confirm one base-layer tx (onboard step or deposit). */
  signBaseTx: (transactionB64: string) => Promise<void>;
  /** Run the one-time session-enable dance (createSessionV2 → confirm → bind). */
  enableSession: () => Promise<void>;
  /** Optional progress hook for the UI status line. */
  onStatus?: (text: string) => void;
}

interface OpenResponse {
  phase?: string;
  steps?: Array<{ transactionB64: string; layer?: string }>;
  quote?: unknown;
  error?: string;
}

interface DepositResponse {
  phase?: string;
  steps?: Array<{ transactionB64: string; layer?: string }>;
  depositTransaction?: string;
  error?: string;
}

// Setup is bounded: enable-session, onboard, deposit, open = at most a few
// round-trips. A higher cap only masks a stuck loop.
const MAX_OPEN_ATTEMPTS = 6;
const MAX_DEPOSIT_ATTEMPTS = 3;

function authHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/**
 * Fund the Flash v2 basket: onboard it first if the deposit route says so, then
 * sign the deposit. Returns once the deposit tx has confirmed.
 */
export async function runSelfV2Deposit(args: {
  amountUsdc: number;
  walletAddress: string;
  http: FundingHttp;
  actions: FundingActions;
}): Promise<void> {
  const f = args.http.fetchImpl ?? fetch;
  for (let attempt = 0; attempt < MAX_DEPOSIT_ATTEMPTS; attempt++) {
    const token = await args.http.getAccessToken();
    if (!token) throw new Error("not authed");
    const resp = await f("/api/users/me/deposit", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        amountUsdc: args.amountUsdc,
        walletAddress: args.walletAddress,
      }),
    });
    const body = (await resp.json().catch(() => ({}))) as DepositResponse;
    if (!resp.ok) throw new Error(body.error ?? `deposit failed (${resp.status})`);
    if (body.phase === "onboard") {
      args.actions.onStatus?.("Setting up your account...");
      for (const s of body.steps ?? []) await args.actions.signBaseTx(s.transactionB64);
      continue; // re-call now that the basket exists to get the deposit tx
    }
    if (body.phase === "deposit" && body.depositTransaction) {
      args.actions.onStatus?.("Opening your position...");
      await args.actions.signBaseTx(body.depositTransaction);
      return;
    }
    throw new Error(body.error ?? "unexpected deposit response");
  }
  throw new Error("Deposit did not complete. Try again.");
}

/**
 * Drive a self-directed Flash v2 open through the funding phases until the server
 * session-signs it. Returns the open quote on success. `depositUsdc` funds the
 * basket on first setup (and as a one-shot top-up if the basket is onboarded but
 * empty). Throws on a genuine open failure once funding is in place.
 */
export async function runSelfV2Open(args: {
  openBody: Record<string, unknown>;
  depositUsdc: number;
  walletAddress: string;
  http: FundingHttp;
  actions: FundingActions;
}): Promise<{ quote: unknown }> {
  const f = args.http.fetchImpl ?? fetch;
  let funded = false;
  for (let attempt = 0; attempt < MAX_OPEN_ATTEMPTS; attempt++) {
    const token = await args.http.getAccessToken();
    if (!token) throw new Error("not authed");
    const resp = await f("/api/trade/perp", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(args.openBody),
    });
    const body = (await resp.json().catch(() => ({}))) as OpenResponse;

    if (resp.ok && body.phase === "open") return { quote: body.quote };

    if (body.phase === "enable-session") {
      args.actions.onStatus?.("Enabling instant trading...");
      await args.actions.enableSession();
      continue;
    }
    if (body.phase === "onboard") {
      args.actions.onStatus?.("Setting up your account...");
      for (const s of body.steps ?? []) await args.actions.signBaseTx(s.transactionB64);
      // Freshly onboarded ⇒ basket is empty: fund it before the first open.
      await runSelfV2Deposit({
        amountUsdc: args.depositUsdc,
        walletAddress: args.walletAddress,
        http: args.http,
        actions: args.actions,
      });
      funded = true;
      continue;
    }

    // The open attempt itself failed (session + basket already exist). If we
    // have not funded yet this run, the most likely cause is an empty basket
    // (e.g. a partially-completed earlier setup) — deposit once and retry. If we
    // already funded, surface the real error.
    if (!resp.ok) {
      if (!funded) {
        await runSelfV2Deposit({
          amountUsdc: args.depositUsdc,
          walletAddress: args.walletAddress,
          http: args.http,
          actions: args.actions,
        });
        funded = true;
        continue;
      }
      throw new Error(body.error ?? `open failed (${resp.status})`);
    }
    throw new Error(body.error ?? "unexpected open response");
  }
  throw new Error("Trade setup did not complete. Try again.");
}
