import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { enrichBet } from "@/lib/positions/enrich";
import { getPositions } from "@/lib/pacifica/client";
import { getMark, getMarksSnapshot } from "@/lib/data/marks";
import type { PacificaPosition } from "@/lib/pacifica/types";
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

type CopyLiveStatus = "open" | "not_found" | "unknown";

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

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  let userPositions: PacificaPosition[] | null = null;
  let positionsUnavailable = false;
  let marks: Map<string, number> | null = null;
  if (copyBets.length > 0 && user.solanaPubkey) {
    try {
      userPositions = await getPositions(user.solanaPubkey);
    } catch (err) {
      positionsUnavailable = true;
      console.warn("[portfolio] pacifica positions fetch failed:", err);
    }
    try {
      marks = await getMarksSnapshot();
    } catch (err) {
      console.warn("[portfolio] marks snapshot failed:", err);
    }
  }
  const copyRows = (
    await Promise.all(
      copyBets
        .filter((b) => b.status === "confirmed")
        .map(async (b) => {
          const whaleMeta = parseWhaleCopyMeta(b.meta);
          const meta = parseCopyRowMeta(b.meta);
          if (!meta) return null;

          const livePos = userPositions?.find(
            (p) =>
              p.symbol === meta.leaderMarket &&
              ((meta.leaderSide === "long" && p.side === "bid") ||
                (meta.leaderSide === "short" && p.side === "ask")),
          );
          const liveStatus: CopyLiveStatus = livePos
            ? "open"
            : positionsUnavailable
              ? "unknown"
              : "not_found";
          const entry = finiteNumber(livePos?.entry_price);
          const size = finiteNumber(livePos?.amount);
          const liquidationPrice = finiteNumber(livePos?.liquidation_price);
          const marginUsd = finiteNumber(livePos?.margin);
          const mark =
            livePos && marks
              ? (marks.get(meta.leaderMarket) ??
                (await getMark(meta.leaderMarket).catch((err) => {
                  console.warn("[portfolio] mark fetch failed:", err);
                  return null;
                })))
              : null;

          let unrealizedPnlPct: number | null = null;
          let pnlUsd: number | null = null;
          if (mark != null && entry != null && size != null && b.amountUsdc > 0) {
            const direction = livePos?.side === "bid" ? 1 : -1;
            pnlUsd = (mark - entry) * Math.abs(size) * direction;
            unrealizedPnlPct = (pnlUsd / b.amountUsdc) * 100;
          }

          return {
            betId: b.id,
            market: meta.leaderMarket,
            side: meta.leaderSide,
            leverage: meta.leverage,
            stakeUsdc: b.amountUsdc,
            leaderAddress: meta.leaderAddress ?? whaleMeta?.sourceAccount ?? null,
            leaderUsername: null,
            whaleId: whaleMeta?.whaleId ?? null,
            whaleName: null,
            autoCloseOnSourceClose: whaleMeta?.autoCloseOnSourceClose ?? false,
            closeReason: whaleMeta?.closeReason ?? null,
            botId: meta.botId ?? null,
            botName: meta.botId ? (getBot(meta.botId)?.name ?? meta.botId) : null,
            liveStatus,
            entryPrice: entry,
            markPrice: mark,
            liquidationPrice,
            amountBase: size == null ? null : Math.abs(size),
            marginUsd: marginUsd != null && marginUsd > 0 ? marginUsd : null,
            marginMode: livePos ? (livePos.isolated ? "isolated" : "cross") : null,
            notionalUsd:
              mark != null && size != null ? mark * Math.abs(size) : null,
            pnlUsd,
            unrealizedPnlPct,
            openedAt: livePos?.created_at
              ? new Date(livePos.created_at).toISOString()
              : null,
            positionUpdatedAt: livePos?.updated_at
              ? new Date(livePos.updated_at).toISOString()
              : null,
            leaderClosedAt: meta.leaderClosedAt ?? null,
          };
        }),
    )
  ).filter((row) => row !== null);

  return NextResponse.json({ positions, copyRows });
}
