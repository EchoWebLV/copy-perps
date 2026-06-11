import { NextResponse } from "next/server";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import {
  AutopilotSessionError,
  getActiveSession,
  getLatestSession,
  MAX_BUDGET_USD,
  MIN_BUDGET_USD,
  sessionStats,
  startSession,
  stopSession,
} from "@/lib/autopilot/sessions";
import { isTierName } from "@/lib/autopilot/tiers";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

interface StartBody {
  budgetUsd?: number;
  tier?: string;
  walletAddress?: string;
}

// The autopilot server signs with Privy's wallet API — same env
// lib/privy/server.ts wires into walletApi.authorizationPrivateKey. With
// it absent every engine send would throw, so refuse to arm at all.
function instantTradingConfigured(): boolean {
  return Boolean(
    process.env.PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY ||
      process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
  );
}

function sessionErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AutopilotSessionError) {
    const status = err.code === "active-session-exists" ? 409 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
  return null;
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!instantTradingConfigured()) {
    return NextResponse.json(
      { error: "Instant trading is not configured on the server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as StartBody | null;
  if (
    typeof body?.budgetUsd !== "number" ||
    !Number.isFinite(body.budgetUsd) ||
    !isTierName(body.tier) ||
    !body.walletAddress
  ) {
    return NextResponse.json(
      {
        error: `budgetUsd ($${MIN_BUDGET_USD}-$${MAX_BUDGET_USD}), tier (cruise|sweat|degen), walletAddress required`,
      },
      { status: 400 },
    );
  }

  const user = await ensureUser(claims.userId, body.walletAddress);
  if (!user.solanaPubkey) {
    return NextResponse.json(
      { error: "no Solana wallet on user" },
      { status: 400 },
    );
  }

  try {
    const session = await startSession({
      userId: user.id,
      budgetUsd: body.budgetUsd,
      tier: body.tier,
    });
    return NextResponse.json({
      session,
      stats: { realizedPnlUsd: 0, closedCount: 0, openBets: [] },
    });
  } catch (err) {
    const mapped = sessionErrorResponse(err);
    if (mapped) return mapped;
    console.error("[autopilot/session] start failed:", err);
    return NextResponse.json(
      { error: "Could not start autopilot. Try again." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);
  // Fall back to the newest ended session so the panel can show WHY the
  // engine stopped (stopped / exhausted / target) instead of silently
  // resetting to the start form.
  const session =
    (await getActiveSession(user.id)) ?? (await getLatestSession(user.id));
  if (!session) {
    return NextResponse.json({ session: null, stats: null });
  }
  const stats = await sessionStats(session.id).catch((err) => {
    console.warn("[autopilot/session] stats failed:", err);
    return null;
  });
  return NextResponse.json({ session, stats });
}

export async function DELETE(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await ensureUser(claims.userId, null);
  const active = await getActiveSession(user.id);
  if (!active) {
    return NextResponse.json(
      { error: "no active autopilot session" },
      { status: 404 },
    );
  }
  const stopped = await stopSession({ sessionId: active.id, userId: user.id });
  if (!stopped) {
    return NextResponse.json(
      { error: "session already ended" },
      { status: 409 },
    );
  }
  return NextResponse.json({
    session: stopped,
    // v1 choice, on purpose: stopping disarms the engine but does NOT
    // close anything. Open positions keep their on-chain TP/SL triggers.
    message:
      "Autopilot stopped. Open positions stay open with their TP/SL triggers — close them from Scalp or Portfolio.",
  });
}
