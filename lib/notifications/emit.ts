// lib/notifications/emit.ts
//
// Pure event builder + DB insert helper for notification_events.
//
// Web push send is NOT here — that is Task 12. See TODO below.
//
// Safety contract:
//   emitNotification() swallows all errors and returns void.
//   Call sites ALSO wrap in try/catch to be belt-and-suspenders safe.
//   A notification emit can NEVER break or alter a money path.

// ── Money formatter ────────────────────────────────────────────────────────
// Mirrors the mock's `fmt`: sign + $ + 2dp for |n| < 100, else 0dp.
function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  const dp = abs < 100 ? 2 : 0;
  return `${sign}$${abs.toFixed(dp)}`;
}

// ── Event shape returned by buildEvent ────────────────────────────────────
export interface NotificationEventPayload {
  userId: string;
  kind: string;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}

// ── Per-kind context types ─────────────────────────────────────────────────

type CopyOpenedCtx = {
  userId: string;
  source: string;
  market: string;
  side: "long" | "short";
  leverage: number;
  stakeUsd: number;
};

type AutoCloseCtx = {
  userId: string;
  source: string;
  market: string;
  pnlUsd?: number | null;
};

type CopyClosedCtx = {
  userId: string;
  source: string;
  market: string;
};

type SourceClosedCtx = {
  userId: string;
  source: string;
  market: string;
};

type AutopilotEndedCtx = {
  userId: string;
  status: "exhausted" | "target" | "stopped";
  realizedPnlUsd?: number | null;
};

// ── Discriminated-union overloads ─────────────────────────────────────────

export function buildEvent(
  kind: "copy-opened",
  ctx: CopyOpenedCtx,
): NotificationEventPayload;
export function buildEvent(
  kind: "auto-close",
  ctx: AutoCloseCtx,
): NotificationEventPayload;
export function buildEvent(
  kind: "copy-closed",
  ctx: CopyClosedCtx,
): NotificationEventPayload;
export function buildEvent(
  kind: "source-closed",
  ctx: SourceClosedCtx,
): NotificationEventPayload;
export function buildEvent(
  kind: "autopilot-ended",
  ctx: AutopilotEndedCtx,
): NotificationEventPayload;

// ── Implementation ─────────────────────────────────────────────────────────

export function buildEvent(
  kind: string,
  ctx: Record<string, unknown>,
): NotificationEventPayload {
  switch (kind) {
    case "copy-opened": {
      const c = ctx as CopyOpenedCtx;
      return {
        userId: c.userId,
        kind,
        title: `Copied ${c.source} — ${c.market} ${c.leverage}x ${c.side} with $${c.stakeUsd}`,
        body: `${c.source} entered ${c.market} ${c.side}. Your copy is live.`,
        meta: {
          source: c.source,
          market: c.market,
          side: c.side,
          leverage: c.leverage,
          stakeUsd: c.stakeUsd,
        },
      };
    }

    case "auto-close": {
      const c = ctx as AutoCloseCtx;
      const hasPnl = c.pnlUsd !== undefined && c.pnlUsd !== null;
      const title = hasPnl
        ? `Auto-close fired: ${fmtMoney(c.pnlUsd!)} on ${c.market}`
        : `Auto-close fired on ${c.market}`;
      return {
        userId: c.userId,
        kind,
        title,
        body: `${c.source} exited — your copy closed with them`,
        meta: {
          source: c.source,
          market: c.market,
          pnlUsd: c.pnlUsd ?? null,
        },
      };
    }

    case "copy-closed": {
      const c = ctx as CopyClosedCtx;
      return {
        userId: c.userId,
        kind,
        title: `Copy closed: ${c.market}`,
        body: `${c.source} position on ${c.market} is no longer being copied. Final P/L pending reconciliation.`,
        meta: { source: c.source, market: c.market },
      };
    }

    case "source-closed": {
      const c = ctx as SourceClosedCtx;
      return {
        userId: c.userId,
        kind,
        title: `${c.source} closed ${c.market} — your copy is detaching`,
        body: `${c.source} exited ${c.market}. Your position will be closed.`,
        meta: { source: c.source, market: c.market },
      };
    }

    case "autopilot-ended": {
      const c = ctx as AutopilotEndedCtx;
      const hasPnl = c.realizedPnlUsd !== undefined && c.realizedPnlUsd !== null;
      const pnlStr = hasPnl ? ` Realized P/L: ${fmtMoney(c.realizedPnlUsd!)}.` : "";

      if (c.status === "exhausted") {
        return {
          userId: c.userId,
          kind,
          title: "Autopilot ended — budget exhausted",
          body: `Your autopilot session ran out of budget.${pnlStr}`,
          meta: { status: c.status, realizedPnlUsd: c.realizedPnlUsd ?? null },
        };
      }
      if (c.status === "target") {
        return {
          userId: c.userId,
          kind,
          title: "Autopilot ended — target reached",
          body: `Your profit target was hit.${pnlStr}`,
          meta: { status: c.status, realizedPnlUsd: c.realizedPnlUsd ?? null },
        };
      }
      // "stopped" (manual)
      return {
        userId: c.userId,
        kind,
        title: "Autopilot stopped",
        body: `Your autopilot session was stopped manually.${pnlStr}`,
        meta: { status: c.status, realizedPnlUsd: c.realizedPnlUsd ?? null },
      };
    }

    default:
      return {
        userId: (ctx["userId"] as string) ?? "",
        kind,
        title: kind,
        body: "",
      };
  }
}

// ── DB insert ──────────────────────────────────────────────────────────────

/**
 * Insert a notification event row. Self-contained: swallows all errors and
 * returns void so it can NEVER break a money path.
 *
 * TODO(Task 12): after the DB insert succeeds, send a Web Push notification
 * to the user's subscribed push endpoints here. Look up push subscriptions
 * from the `push_subscriptions` table and call webpush.sendNotification().
 */
export async function emitNotification(
  event: NotificationEventPayload,
): Promise<void> {
  try {
    // Lazy import avoids pulling the DB client into pure-engine bundles.
    const { db } = await import("@/lib/db");
    const { notificationEvents } = await import("@/lib/db/schema");
    await db.insert(notificationEvents).values({
      userId: event.userId,
      kind: event.kind,
      title: event.title,
      body: event.body,
      meta: event.meta ?? null,
    });
  } catch (err) {
    // Never propagate — notifications are observability, not business logic.
    console.error("[notifications] emitNotification failed (non-fatal):", err);
  }
}
