// lib/notifications/push.ts
//
// Web push sender. Safe to call from anywhere — never throws, logs on errors.
// Missing VAPID keys are a no-op (local dev without keys set).

import webpush from "web-push";
import { eq } from "drizzle-orm";

// ── VAPID configuration ────────────────────────────────────────────────────────

let _configured = false;
let _configAttempted = false;

function ensureConfigured(): boolean {
  if (_configAttempted) return _configured;
  _configAttempted = true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.warn(
      "[push] VAPID keys not set — web push is disabled. " +
        "Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.",
    );
    _configured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    _configured = true;
  } catch (err) {
    console.error("[push] Failed to configure web-push VAPID details:", err);
    _configured = false;
  }

  return _configured;
}

// ── URL helper ─────────────────────────────────────────────────────────────────

export function notificationUrlForKind(kind: string): string {
  switch (kind) {
    case "copy-opened":
    case "copy-closed":
    case "auto-close":
    case "source-closed":
    case "autopilot-ended":
      return "/portfolio";
    default:
      return "/portfolio";
  }
}

// ── Push sender ────────────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push notification to all subscribed endpoints for a user.
 *
 * Safety contract:
 *   - Never throws. All errors are swallowed and logged.
 *   - Dead endpoints (HTTP 404/410 from push service) are pruned automatically.
 *   - One bad endpoint never stops the others.
 *   - Missing VAPID keys → silent no-op.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;

  try {
    // Lazy imports to avoid pulling DB into pure-engine bundles
    const { db } = await import("@/lib/db");
    const { pushSubscriptions } = await import("@/lib/db/schema");

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    if (subs.length === 0) return;

    const deadEndpoints: string[] = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        const pushSub: webpush.PushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };

        try {
          await webpush.sendNotification(pushSub, JSON.stringify(payload));
        } catch (err) {
          // 410 = Gone (subscription expired/revoked); 404 = also dead
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            deadEndpoints.push(sub.endpoint);
          } else {
            console.error(
              `[push] sendNotification failed for endpoint ${sub.endpoint.slice(0, 40)}…:`,
              err,
            );
          }
        }
      }),
    );

    // Prune dead endpoints
    if (deadEndpoints.length > 0) {
      await Promise.allSettled(
        deadEndpoints.map((endpoint) =>
          db
            .delete(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, endpoint))
            .catch((pruneErr) =>
              console.error("[push] Failed to prune dead endpoint:", pruneErr),
            ),
        ),
      );
    }
  } catch (err) {
    // Never propagate — push is observability, not business logic
    console.error("[push] sendPushToUser failed (non-fatal):", err);
  }
}
