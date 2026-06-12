import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { ensureUser } from "@/lib/users/ensure";
import { ARENA_PERSONAS } from "@/lib/arena/personas";
import { parseWhaleTargetKey } from "@/lib/copy/sources";
import {
  countOpenCopies,
  createCopySubscription,
  listUserCopySubscriptions,
  setCopySubscriptionStatus,
  spentLast24hUsd,
} from "@/lib/copy/store";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MIN_STAKE_USDC = 1;
const MAX_STAKE_USDC = 1000;
const MAX_CONCURRENT_CAP = 3;
const MIN_ENTRY_GAP_BPS = 10;
const MAX_ENTRY_GAP_BPS = 1000;

// The copy engine signs with Privy's wallet API (autopilot's path). With
// the authorization key absent every copy send would throw — refuse to arm.
function instantTradingConfigured(): boolean {
  return Boolean(
    process.env.PRIVY_WALLET_AUTHORIZATION_PRIVATE_KEY ||
      process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
  );
}

interface CreateBody {
  targetKind?: string;
  targetKey?: string;
  targetLabel?: string;
  stakeUsdc?: number;
  leverageMode?: string;
  fixedLeverage?: number;
  autoClose?: boolean;
  maxConcurrent?: number;
  dailyCapUsd?: number;
  maxEntryGapBps?: number;
  walletAddress?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export async function POST(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!instantTradingConfigured()) {
    return NextResponse.json(
      { error: "Copy trading is not configured on the server." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  if (
    !body ||
    (body.targetKind !== "arena-bot" &&
      body.targetKind !== "flash-wallet" &&
      body.targetKind !== "whale") ||
    typeof body.targetKey !== "string" ||
    body.targetKey.length === 0 ||
    typeof body.stakeUsdc !== "number" ||
    !Number.isFinite(body.stakeUsdc)
  ) {
    return NextResponse.json(
      {
        error:
          "targetKind (arena-bot|flash-wallet|whale), targetKey, stakeUsdc required",
      },
      { status: 400 },
    );
  }
  if (body.stakeUsdc < MIN_STAKE_USDC || body.stakeUsdc > MAX_STAKE_USDC) {
    return NextResponse.json(
      { error: `stake must be between $${MIN_STAKE_USDC} and $${MAX_STAKE_USDC}` },
      { status: 400 },
    );
  }

  const leverageMode = body.leverageMode === "fixed" ? "fixed" : "mirror";
  let fixedLeverage: number | null = null;
  if (leverageMode === "fixed") {
    if (
      typeof body.fixedLeverage !== "number" ||
      !Number.isFinite(body.fixedLeverage) ||
      body.fixedLeverage < 1.1 ||
      body.fixedLeverage > 500
    ) {
      return NextResponse.json(
        { error: "fixedLeverage must be between 1.1x and 500x" },
        { status: 400 },
      );
    }
    fixedLeverage = body.fixedLeverage;
  }

  const maxConcurrent = Math.min(
    MAX_CONCURRENT_CAP,
    Math.max(1, Math.round(body.maxConcurrent ?? 1)),
  );
  const dailyCapUsd =
    typeof body.dailyCapUsd === "number" &&
    Number.isFinite(body.dailyCapUsd) &&
    body.dailyCapUsd >= body.stakeUsdc
      ? Math.min(body.dailyCapUsd, 5000)
      : body.stakeUsdc * 10;
  const maxEntryGapBps = Math.min(
    MAX_ENTRY_GAP_BPS,
    Math.max(MIN_ENTRY_GAP_BPS, Math.round(body.maxEntryGapBps ?? 100)),
  );

  const user = await ensureUser(claims.userId, body.walletAddress ?? null);
  if (!user.solanaPubkey) {
    return NextResponse.json({ error: "no Solana wallet on user" }, { status: 400 });
  }

  let targetLabel = body.targetLabel?.slice(0, 64) ?? null;
  if (body.targetKind === "arena-bot") {
    const persona = ARENA_PERSONAS[body.targetKey];
    if (!persona) {
      return NextResponse.json({ error: "unknown arena bot" }, { status: 400 });
    }
    targetLabel ??= persona.display;
  } else if (body.targetKind === "whale") {
    if (!parseWhaleTargetKey(body.targetKey)) {
      return NextResponse.json(
        { error: "whale targetKey must be source:account" },
        { status: 400 },
      );
    }
  } else {
    try {
      // Throws on anything that isn't a valid base58 pubkey.
      void new PublicKey(body.targetKey);
    } catch {
      return NextResponse.json(
        { error: "targetKey must be a Solana wallet address" },
        { status: 400 },
      );
    }
    if (body.targetKey === user.solanaPubkey) {
      return NextResponse.json(
        { error: "you cannot copy your own wallet" },
        { status: 400 },
      );
    }
  }

  try {
    const subscription = await createCopySubscription({
      userId: user.id,
      targetKind: body.targetKind,
      targetKey: body.targetKey,
      targetLabel,
      stakeUsdc: body.stakeUsdc,
      leverageMode,
      fixedLeverage,
      autoClose: body.autoClose !== false,
      maxConcurrent,
      dailyCapUsd,
      maxEntryGapBps,
    });
    return NextResponse.json({ subscription });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "already copying this target — stop the existing copy first" },
        { status: 409 },
      );
    }
    console.error("[copy/subscriptions] create failed:", err);
    return NextResponse.json(
      { error: "Could not start copying. Try again." },
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
  const rows = await listUserCopySubscriptions(user.id);
  const subscriptions = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      openCopies: await countOpenCopies(row.id).catch(() => 0),
      spent24hUsd: await spentLast24hUsd(row.id).catch(() => 0),
    })),
  );
  return NextResponse.json({ subscriptions });
}

interface PatchBody {
  id?: string;
  status?: string;
}

export async function PATCH(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (
    !body?.id ||
    (body.status !== "active" && body.status !== "paused" && body.status !== "stopped")
  ) {
    return NextResponse.json(
      { error: "id and status (active|paused|stopped) required" },
      { status: 400 },
    );
  }
  const user = await ensureUser(claims.userId, null);
  const updated = await setCopySubscriptionStatus({
    id: body.id,
    userId: user.id,
    status: body.status,
  });
  if (!updated) {
    return NextResponse.json({ error: "subscription not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
