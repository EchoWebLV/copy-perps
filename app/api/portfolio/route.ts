import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { bets, users } from "@/lib/db/schema";
import { verifyPrivyRequest } from "@/lib/privy/server";
import { enrichBet } from "@/lib/positions/enrich";
import { getAccountInfo, getPositions } from "@/lib/pacifica/client";
import { findUncreditedPacificaDeposits } from "@/lib/pacifica/deposit-reconcile";
import { getMark, getMarksSnapshot } from "@/lib/data/marks";
import { getFlashPerpsService, type FlashPositionSummary } from "@/lib/flash/perps";
import { flashStakeUsdFromPosition } from "@/lib/flash/position-value";
import type { PacificaPosition } from "@/lib/pacifica/types";
import { parseWhaleCopyMeta } from "@/lib/bets/whale-meta";
import { parseFlashTailMeta } from "@/lib/bets/flash-tail-meta";
import {
  buildPortfolioSummary,
  type PortfolioSnapshotPayload,
  type PortfolioWalletBalance,
} from "@/lib/positions/portfolio-snapshot";
import { savePortfolioSnapshotForUser } from "@/lib/positions/portfolio-snapshot-store";
import {
  getJupUsdBalance,
  getSolBalance,
  getUsdcBalance,
} from "@/lib/solana/balance";

const STALE_PENDING_MS = 5 * 60 * 1000;
const PORTFOLIO_MARK_CACHE_MS = 3_000;

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
type CopySourceKind = "tail" | "wallet";
type CopyVenue = "pacifica" | "flash";

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

function optionalFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  return finiteNumber(value);
}

function isoFromMillis(value: unknown): string | null {
  const n = finiteNumber(value);
  return n == null || n <= 0 ? null : new Date(n).toISOString();
}

function sideFromPacifica(side: PacificaPosition["side"]): "long" | "short" {
  return side === "bid" ? "long" : "short";
}

function positionKey(market: string, side: "long" | "short"): string {
  return `${market}:${side}`;
}

function flashRowFromPosition(
  p: FlashPositionSummary,
  pricedAt: string,
  tailBet?: { id: string; meta: ReturnType<typeof parseFlashTailMeta> } | null,
): PortfolioSnapshotPayload["copyRows"][number] {
  const stakeUsdc = flashStakeUsdFromPosition(p);
  const marginUsd =
    Number.isFinite(p.collateralUsd) && p.collateralUsd > 0
      ? p.collateralUsd
      : stakeUsdc;
  const openFeeUsd = optionalFiniteNumber(p.openFeeUsd);
  const rawPnlUsd = Number.isFinite(p.pnlUsd) ? (p.pnlUsd ?? null) : null;
  const pnlUsd =
    rawPnlUsd == null ? null : rawPnlUsd - (openFeeUsd ?? 0);
  const unrealizedPnlPct =
    stakeUsdc != null && pnlUsd != null ? (pnlUsd / stakeUsdc) * 100 : null;

  return {
    betId: tailBet?.id ?? null,
    venue: "flash" satisfies CopyVenue,
    sourceKind: tailBet
      ? ("tail" satisfies CopySourceKind)
      : ("wallet" satisfies CopySourceKind),
    market: p.symbol,
    side: p.side,
    leverage:
      p.leverage != null && Number.isFinite(p.leverage) ? p.leverage : null,
    stakeUsdc,
    openFeeUsd,
    leaderAddress: null,
    leaderUsername: null,
    whaleId: tailBet?.meta?.whaleId ?? null,
    whaleName:
      tailBet?.meta?.sourceKind === "whale"
        ? (tailBet.meta.sourceName ?? null)
        : null,
    autoCloseOnSourceClose: false,
    closeReason: null,
    botId: tailBet?.meta?.botId ?? null,
    botName:
      tailBet?.meta?.sourceKind === "bot"
        ? (tailBet.meta.sourceName ?? null)
        : null,
    liveStatus: "open" satisfies CopyLiveStatus,
    entryPrice: p.entryPriceUsd,
    markPrice: p.markPriceUsd ?? null,
    pricedAt: p.markPriceUsd == null ? null : pricedAt,
    liquidationPrice: p.liquidationPriceUsd ?? null,
    amountBase: null,
    marginUsd,
    marginMode: "isolated" as const,
    notionalUsd: p.sizeUsd,
    pnlUsd,
    unrealizedPnlPct,
    openedAt: new Date(p.openTime).toISOString(),
    positionUpdatedAt: pricedAt,
    leaderClosedAt: null,
  };
}

async function markForSymbol(
  symbol: string,
  marks: Map<string, number> | null,
): Promise<number | null> {
  const cached = marks?.get(symbol);
  if (cached != null) return cached;
  return getMark(symbol).catch((err) => {
    console.warn("[portfolio] mark fetch failed:", err);
    return null;
  });
}

export async function GET(request: Request) {
  const pricedAt = new Date().toISOString();
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

  const legacyBets = userBets.filter((b) => b.type !== "flash-tail");
  const positions = await Promise.all(
    legacyBets.map((bet) => enrichBet(bet, user.solanaPubkey)),
  );

  // --- Pacifica copy bets ---
  const copyBets = userBets.filter((b) => b.type === "copy");
  let userPositions: PacificaPosition[] | null = null;
  let flashPositions: FlashPositionSummary[] = [];
  let positionsUnavailable = false;
  const liveErrors: string[] = [];
  let marks: Map<string, number> | null = null;
  let walletBalance: PortfolioWalletBalance | null = null;
  let pacificaAccount: {
    balanceUsd: number | null;
    equityUsd: number | null;
    availableToSpendUsd: number | null;
    availableToWithdrawUsd: number | null;
    totalMarginUsedUsd: number | null;
    pendingDepositUsd: number;
    pendingDeposits: Array<{
      amountUsdc: number;
      signature: string;
      createdAt: string;
    }>;
    updatedAt: string | null;
  } | null = null;
  if (user.solanaPubkey) {
    try {
      userPositions = await getPositions(user.solanaPubkey);
    } catch (err) {
      positionsUnavailable = true;
      liveErrors.push("Pacifica positions delayed");
      console.warn("[portfolio] pacifica positions fetch failed:", err);
    }
    try {
      flashPositions = await getFlashPerpsService().positionsOf(user.solanaPubkey);
    } catch (err) {
      liveErrors.push("Flash positions delayed");
      console.warn("[portfolio] flash positions fetch failed:", err);
    }
    try {
      marks = await getMarksSnapshot({ maxAgeMs: PORTFOLIO_MARK_CACHE_MS });
    } catch (err) {
      liveErrors.push("Marks delayed");
      console.warn("[portfolio] marks snapshot failed:", err);
    }
    try {
      const account = await getAccountInfo(user.solanaPubkey);
      const pending = await findUncreditedPacificaDeposits({
        account: user.solanaPubkey,
      }).catch((err) => {
        console.warn("[portfolio] pacifica deposit reconcile failed:", err);
        return { totalUsdc: 0, deposits: [] };
      });
      pacificaAccount = {
        balanceUsd: finiteNumber(account.balance),
        equityUsd: finiteNumber(account.account_equity),
        availableToSpendUsd: finiteNumber(account.available_to_spend),
        availableToWithdrawUsd: finiteNumber(account.available_to_withdraw),
        totalMarginUsedUsd: finiteNumber(account.total_margin_used),
        pendingDepositUsd: pending.totalUsdc,
        pendingDeposits: pending.deposits,
        updatedAt: isoFromMillis(account.updated_at),
      };
    } catch (err) {
      liveErrors.push("Pacifica account delayed");
      console.warn("[portfolio] pacifica account fetch failed:", err);
    }
    try {
      const [usdc, jupUsd, sol] = await Promise.all([
        getUsdcBalance(user.solanaPubkey),
        getJupUsdBalance(user.solanaPubkey),
        getSolBalance(user.solanaPubkey),
      ]);
      walletBalance = {
        stableUsd: usdc + jupUsd,
        sol,
        updatedAt: pricedAt,
      };
    } catch (err) {
      liveErrors.push("Wallet balance delayed");
      console.warn("[portfolio] wallet balance fetch failed:", err);
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
          const mark = livePos ? await markForSymbol(meta.leaderMarket, marks) : null;

          let unrealizedPnlPct: number | null = null;
          let pnlUsd: number | null = null;
          const openFeeUsd = optionalFiniteNumber(b.feeUsdc);
          if (mark != null && entry != null && size != null && b.amountUsdc > 0) {
            const direction = livePos?.side === "bid" ? 1 : -1;
            pnlUsd =
              (mark - entry) * Math.abs(size) * direction - (openFeeUsd ?? 0);
            unrealizedPnlPct = (pnlUsd / b.amountUsdc) * 100;
          }

          return {
            betId: b.id,
            venue: "pacifica" satisfies CopyVenue,
            sourceKind: "tail" satisfies CopySourceKind,
            market: meta.leaderMarket,
            side: meta.leaderSide,
            leverage: meta.leverage,
            stakeUsdc: b.amountUsdc,
            openFeeUsd,
            leaderAddress: meta.leaderAddress ?? whaleMeta?.sourceAccount ?? null,
            leaderUsername: null,
            whaleId: whaleMeta?.whaleId ?? null,
            whaleName: null,
            autoCloseOnSourceClose: whaleMeta?.autoCloseOnSourceClose ?? false,
            closeReason: whaleMeta?.closeReason ?? null,
            botId: meta.botId ?? null,
            botName: meta.botId ?? null,
            liveStatus,
            entryPrice: entry,
            markPrice: mark,
            pricedAt: mark == null ? null : pricedAt,
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

  const coveredLivePositions = new Set(
    copyRows
      .filter((row) => row.liveStatus === "open")
      .map((row) => positionKey(row.market, row.side)),
  );
  const walletRows = await Promise.all(
    (userPositions ?? [])
      .filter(
        (p) =>
          !coveredLivePositions.has(
            positionKey(p.symbol, sideFromPacifica(p.side)),
          ),
      )
      .map(async (p) => {
        const side = sideFromPacifica(p.side);
        const entry = finiteNumber(p.entry_price);
        const size = finiteNumber(p.amount);
        const liquidationPrice = finiteNumber(p.liquidation_price);
        const marginUsd = finiteNumber(p.margin);
        const mark = await markForSymbol(p.symbol, marks);
        const pnlUsd =
          mark != null && entry != null && size != null
            ? (mark - entry) * Math.abs(size) * (side === "long" ? 1 : -1)
            : null;

        return {
          betId: null,
          venue: "pacifica" satisfies CopyVenue,
          sourceKind: "wallet" satisfies CopySourceKind,
          market: p.symbol,
          side,
          leverage: null,
          stakeUsdc: null,
          leaderAddress: null,
          leaderUsername: null,
          whaleId: null,
          whaleName: null,
          autoCloseOnSourceClose: false,
          closeReason: null,
          botId: null,
          botName: null,
          liveStatus: "open" satisfies CopyLiveStatus,
          entryPrice: entry,
          markPrice: mark,
          pricedAt: mark == null ? null : pricedAt,
          liquidationPrice,
          amountBase: size == null ? null : Math.abs(size),
          marginUsd: marginUsd != null && marginUsd > 0 ? marginUsd : null,
          marginMode: p.isolated ? "isolated" : "cross",
          notionalUsd: mark != null && size != null ? mark * Math.abs(size) : null,
          pnlUsd,
          unrealizedPnlPct: null,
          openedAt: p.created_at ? new Date(p.created_at).toISOString() : null,
          positionUpdatedAt: p.updated_at
            ? new Date(p.updated_at).toISOString()
            : null,
          leaderClosedAt: null,
        };
      }),
  );
  // Newest confirmed flash-tail bet per market:side (userBets is newest-
  // first; first-wins keeps the live one — Flash holds one position per
  // owner+market+side). Known limitation: a confirmed bet whose position
  // died externally (liquidation, trigger close, lost close postback)
  // mis-attributes a later Scalp open on the same key. No expiry exists
  // yet — sweep-side expiry of externally-closed positions is a planned
  // follow-up.
  const flashTailByKey = new Map<
    string,
    { id: string; meta: ReturnType<typeof parseFlashTailMeta> }
  >();
  for (const b of userBets) {
    if (b.type !== "flash-tail" || b.status !== "confirmed") continue;
    const meta = parseFlashTailMeta(b.meta);
    if (!meta) continue;
    const key = positionKey(meta.market, meta.side);
    if (!flashTailByKey.has(key)) flashTailByKey.set(key, { id: b.id, meta });
  }
  const flashRows = flashPositions.map((p) =>
    flashRowFromPosition(p, pricedAt, flashTailByKey.get(positionKey(p.symbol, p.side)) ?? null),
  );
  const liveCopyRows = [
    ...copyRows,
    ...walletRows,
    ...flashRows,
  ] as PortfolioSnapshotPayload["copyRows"];
  const payload: PortfolioSnapshotPayload = {
    positions,
    copyRows: liveCopyRows,
    pacificaAccount,
    walletBalance,
  };
  const status = liveErrors.length > 0 ? "delayed" : "live";
  const staleReason = liveErrors.length > 0 ? liveErrors.join(", ") : null;
  const summary = buildPortfolioSummary(payload);

  const saved = await savePortfolioSnapshotForUser({
    userId: user.id,
    payload,
    status,
    staleReason,
  }).catch((err) => {
    console.warn("[portfolio] snapshot save failed:", err);
    return null;
  });

  const result =
    saved ?? {
      payload,
      summary,
      snapshot: {
        source: "live",
        status,
        updatedAt: pricedAt,
        staleReason,
      },
    };

  return NextResponse.json({
    ...result.payload,
    ...result,
  });
}
