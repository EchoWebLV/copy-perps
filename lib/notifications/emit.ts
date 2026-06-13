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
// Mirrors the mock's `fmt` exactly:
//   sign + "$" + Math.abs(n).toLocaleString(undefined, {
//     maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0
//   })
// This gives thousands separators (1,235) and drops trailing zeros above $100
// (25 → "+$25", not "+$25.00").
function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: abs < 100 ? 2 : 0 })}`;
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
      // TODO: neither "auto-close" nor "copy-closed" carries net P/L because
      // gross receive ≠ net at emit time — final P/L is only known after the
      // reconcile sweep prices the close tx on-chain.  A future enhancement
      // is a reconcile-time re-emit (or event update) once chain P/L is settled.
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
 * Insert a notification event row and send a Web Push to all subscribed
 * endpoints for the user. Self-contained: swallows all errors and returns
 * void so it can NEVER break a money path.
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

    // Task 12: fire web push after the DB row is confirmed.
    // sendPushToUser is self-safe (never throws).
    const { sendPushToUser, notificationUrlForKind } = await import(
      "@/lib/notifications/push"
    );
    await sendPushToUser(event.userId, {
      title: event.title,
      body: event.body,
      url: notificationUrlForKind(event.kind),
    });
  } catch (err) {
    // Never propagate — notifications are observability, not business logic.
    console.error("[notifications] emitNotification failed (non-fatal):", err);
  }
}
