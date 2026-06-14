"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCENT, BG, DIM, FAINT, FG, FONT_DISPLAY, PANEL } from "@/components/v2/ui";
import { DESKTOP_NAV_ITEMS, isShellNavActive } from "./nav-items";
import { NotificationBell } from "./NotificationBell";

export function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav
      className="hidden lg:flex lg:h-dvh lg:w-[76px] lg:flex-col lg:items-center lg:border-r lg:px-3 lg:py-4"
      style={{ background: BG, borderColor: FAINT, fontFamily: FONT_DISPLAY }}
      aria-label="Primary"
    >
      <Link
        href="/feed"
        prefetch={false}
        className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl text-[12px] font-black"
        style={{ background: ACCENT, color: BG }}
        aria-label="gwak.gg whales"
      >
        G
      </Link>
      <div className="flex flex-1 flex-col gap-2">
        {DESKTOP_NAV_ITEMS.map((item) => {
          const active = isShellNavActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-label={item.label}
              title={item.label}
              className="group relative flex h-11 w-11 items-center justify-center rounded-2xl transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                background: active ? ACCENT : PANEL,
                color: active ? BG : FG,
                border: `1px solid ${active ? ACCENT : FAINT}`,
                opacity: active ? 1 : 0.68,
              }}
            >
              <Icon size={19} strokeWidth={active ? 3 : 2.4} />
              <span
                className="pointer-events-none absolute left-[52px] z-50 hidden rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-widest group-hover:block group-focus-visible:block"
                style={{ background: PANEL, color: active ? ACCENT : DIM, border: `1px solid ${FAINT}` }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      {/* Notification bell pinned to the bottom of the desktop sidebar —
          reachable from all primary surfaces (Trade, Portfolio, Wallet, etc.)
          since DesktopNav is rendered inside every AppShell. */}
      {process.env.NEXT_PUBLIC_SHOW_NOTIFICATIONS === "true" && (
        <div className="mt-auto">
          <NotificationBell />
        </div>
      )}
    </nav>
  );
}
