"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Zap, CheckCircle, X, AlertCircle, PlayCircle } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import {
  ACCENT,
  BG,
  FAINT,
  FG,
  FONT_DISPLAY,
  GREEN,
  RED,
  TEAL,
  AI,
  PANEL,
  PANEL_2,
  DIM,
} from "@/components/v2/ui";
import type { NotificationDto } from "@/app/api/notifications/route";

const POLL_MS = 60_000;

// ── Relative-time helper ──────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Per-kind icon + color ─────────────────────────────────────────────────

type KindConfig = { Icon: typeof Bell; bg: string; color: string };

function kindConfig(kind: string): KindConfig {
  switch (kind) {
    case "copy-opened":
      return { Icon: Zap, bg: `${GREEN}22`, color: GREEN };
    case "copy-closed":
      return { Icon: CheckCircle, bg: `${TEAL}22`, color: TEAL };
    case "auto-close":
      return { Icon: CheckCircle, bg: `${GREEN}22`, color: GREEN };
    case "source-closed":
      return { Icon: X, bg: `${RED}22`, color: RED };
    case "autopilot-ended":
      return { Icon: PlayCircle, bg: `${AI}22`, color: AI };
    case "subscription-paused":
      return { Icon: AlertCircle, bg: `#ffc55522`, color: "#ffc555" };
    default:
      return { Icon: Bell, bg: `${FAINT}`, color: FG };
  }
}

// ── Main component ────────────────────────────────────────────────────────

export function NotificationBell() {
  const { authenticated, getAccessToken } = usePrivy();
  const [events, setEvents] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!authenticated) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { events: NotificationDto[]; unread: number };
      setEvents(data.events);
      setUnread(data.unread);
    } catch {
      // non-fatal — bell is observability only
    }
  }, [authenticated, getAccessToken]);

  // Visibility-aware poll (mirrors useVisiblePoll from UnifiedFeed.tsx)
  useEffect(() => {
    if (!authenticated) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;

    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void fetchNotifications().finally(() => {
        inFlight = false;
      });
    };

    const start = () => {
      if (timer) return;
      if (typeof document === "undefined" || !document.hidden) run();
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, POLL_MS);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authenticated, fetchNotifications]);

  // Close sheet on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = useCallback(async () => {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      // Optimistically zero the badge
      setUnread(0);
      setEvents((prev) => prev.map((e) => ({ ...e, readAt: e.readAt ?? new Date().toISOString() })));
      // Fire-and-forget mark-all-read
      try {
        const token = await getAccessToken();
        await fetch("/api/notifications", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // non-fatal
      }
    }
  }, [open, unread, getAccessToken]);

  if (!authenticated) return null;

  return (
    <div className="relative" style={{ fontFamily: FONT_DISPLAY }}>
      {/* Bell button */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95"
        style={{
          background: PANEL,
          border: `1px solid ${FAINT}`,
        }}
      >
        <Bell size={17} strokeWidth={2} color={FG} />
        {unread > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full font-black"
            style={{
              top: 5,
              right: 6,
              minWidth: 15,
              height: 15,
              padding: "0 4px",
              background: ACCENT,
              color: BG,
              fontSize: 9,
            }}
            aria-hidden="true"
          >
            {unread}
          </span>
        )}
      </button>

      {/* Activity sheet / popover */}
      {open && (
        <>
          {/* Mobile scrim */}
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: "rgba(0,0,0,0.55)" }}
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />

          {/* Sheet: bottom-sheet on mobile, popover on desktop */}
          <div
            ref={sheetRef}
            className={[
              "z-50 flex flex-col overflow-hidden",
              // Mobile: fixed bottom sheet
              "fixed bottom-0 left-0 right-0 max-h-[80dvh] rounded-t-[26px]",
              // Desktop: absolute dropdown below bell
              "lg:absolute lg:bottom-auto lg:left-auto lg:right-0 lg:top-10 lg:w-[400px] lg:rounded-[20px] lg:border",
            ].join(" ")}
            style={{
              background: PANEL,
              borderColor: FAINT,
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
            }}
          >
            {/* Grab bar (mobile only) */}
            <div className="flex justify-center pt-3 pb-1 lg:hidden" aria-hidden="true">
              <span
                className="h-1 w-10 rounded-full"
                style={{ background: FAINT }}
              />
            </div>

            {/* Header */}
            <div className="flex-none px-5 pt-4 pb-3">
              <h3
                className="font-black uppercase"
                style={{ fontSize: 17, letterSpacing: "0.02em", color: FG }}
              >
                Activity
              </h3>
              <p
                className="mt-1 leading-relaxed"
                style={{ fontSize: 11, color: DIM }}
              >
                Every copy event, the moment it happens.
              </p>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: FAINT, flexShrink: 0 }} />

            {/* Event list */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
              {events.length === 0 ? (
                <p
                  className="mt-4 leading-relaxed"
                  style={{ fontSize: 12, color: DIM }}
                >
                  No alerts yet. Copy a trader and we&apos;ll tell you everything
                  that happens — opens, closes, and auto-closes.
                </p>
              ) : (
                events.map((event) => {
                  const { Icon, bg, color } = kindConfig(event.kind);
                  return (
                    <div
                      key={event.id}
                      className="flex gap-3 border-b py-3"
                      style={{ borderColor: FAINT }}
                    >
                      {/* Kind icon */}
                      <span
                        className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px]"
                        style={{ background: bg }}
                      >
                        <Icon size={14} strokeWidth={2.5} color={color} />
                      </span>

                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-bold leading-snug"
                          style={{ fontSize: 12.5, color: FG }}
                        >
                          {event.title}
                        </p>
                        <p
                          className="mt-0.5 leading-snug"
                          style={{ fontSize: 10, color: DIM }}
                        >
                          {event.body} · {timeAgo(event.createdAt)}
                        </p>
                      </div>

                      {/* Unread dot */}
                      {event.readAt === null && (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                          style={{ background: ACCENT }}
                          aria-label="unread"
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
