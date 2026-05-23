import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { enrichBet } from "@/lib/positions/enrich";
import { getPositions } from "@/lib/pacifica/client";
import { getMarksSnapshot } from "@/lib/data/marks";
import { getBot } from "@/lib/bots";
import { parseWhaleCopyMeta } from "@/lib/bets/whale-meta";

const STALE_PENDING_MS = 5 * 60 * 1000;

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type CopyRowMeta = {
  leaderMarket: string;
  leaderSide: "long" | "short";
  leverage: number;
  leaderAddress?: string;
  botId?: string;
  leaderClosedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseCopyRowMeta(value: unknown): CopyRowMeta | null {
  if (!isRecord(value)) return null;
  if (typeof value.leaderMarket !== "string") return null;
  if (value.leaderSide !== "long" && value.leaderSide !== "short") return null;
  if (typeof value.leverage !== "number" || !Number.isFinite(value.leverage)) {
    return null;
  }

  return {
    leaderMarket: value.leaderMarket,
    leaderSide: value.leaderSide,
    leverage: value.leverage,
    leaderAddress: optionalString(value.leaderAddress),
    botId: optionalString(value.botId),
    leaderClosedAt: optionalString(value.leaderClosedAt),
  };
}

export async function GET(request: Request) {
  const claims = await verifyPrivyRequest(request);
  if (!claims) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, claims.userId))
    .limit(1);
  if (!user) return NextResponse.json({ positions: [] });

  // Reap pending bets that never reached the confirm step (sign cancelled,
  // wallet modal closed, network died mid-sign, etc.) so they don't clutter
  // the portfolio forever.
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  await db
    .update(bets)
    .set({ status: "abandoned" })
    .where(
      and(
        eq(bets.userId, user.id),
        eq(bets.status, "pending"),
        lt(bets.createdAt, staleCutoff),
      ),
    );

  const userBets = await db
    .select()
    .from(bets)
    .where(
      and(
        eq(bets.userId, user.id),
        inArray(bets.status, ["pending", "confirmed", "closed"]),
      ),
    )
    .orderBy(desc(bets.createdAt));

  const positions = await Promise.all(
    userBets.map((bet) => enrichBet(bet, user.solanaPubkey)),
  );

  // --- Pacifica copy bets ---
  const copyBets = userBets.filter((b) => b.type === "copy");
  let userPositions = null;
  let marks: Map<string, number> | null = null;
  if (copyBets.length > 0 && user.solanaPubkey) {
    try {
      userPositions = await getPositions(user.solanaPubkey);
    } catch (err) {
      console.warn("[portfolio] pacifica positions fetch failed:", err);
    }
    try {
      marks = await getMarksSnapshot();
    } catch (err) {
      console.warn("[portfolio] marks snapshot failed:", err);
    }
  }
  const copyRows = copyBets
    .filter((b) => b.status === "confirmed")
    .flatMap((b) => {
      const whaleMeta = parseWhaleCopyMeta(b.meta);
      const meta = parseCopyRowMeta(b.meta);
      if (!meta) return [];
      const livePos = userPositions?.find(
        (p) =>
          p.symbol === meta.leaderMarket &&
          ((meta.leaderSide === "long" && p.side === "bid") ||
            (meta.leaderSide === "short" && p.side === "ask")),
      );
      // Live unrealized PnL as a % of stake. Pacifica's /positions omits
      // computed PnL, so derive it from the position's entry vs the
      // current mark. Null when the position or a mark is unavailable.
      let unrealizedPnlPct: number | null = null;
      if (livePos && marks && b.amountUsdc > 0) {
        const mark = marks.get(meta.leaderMarket);
        const entry = Number(livePos.entry_price);
        const size = Number(livePos.amount);
        if (mark != null && Number.isFinite(entry) && Number.isFinite(size)) {
          const dir = livePos.side === "bid" ? 1 : -1;
          const pnlUsd = (mark - entry) * size * dir;
          unrealizedPnlPct = (pnlUsd / b.amountUsdc) * 100;
        }
      }
      return {
        betId: b.id,
        market: meta.leaderMarket,
        side: meta.leaderSide,
        leverage: meta.leverage,
        stakeUsdc: b.amountUsdc,
        leaderAddress: meta.leaderAddress ?? whaleMeta?.sourceAccount ?? null,
        leaderUsername: whaleMeta?.whaleId ?? null,
        whaleId: whaleMeta?.whaleId ?? null,
        whaleName: whaleMeta?.whaleId ?? null,
        autoCloseOnSourceClose: whaleMeta?.autoCloseOnSourceClose ?? false,
        closeReason: whaleMeta?.closeReason ?? null,
        botId: meta.botId ?? null,
        botName: meta.botId ? (getBot(meta.botId)?.name ?? meta.botId) : null,
        unrealizedPnlPct,
        leaderClosedAt: meta.leaderClosedAt ?? null,
      };
    });

  return NextResponse.json({ positions, copyRows });
}
