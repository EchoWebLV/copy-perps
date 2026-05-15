"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Radio, PieChart, Settings, Zap } from "lucide-react";
import {
  ACCENT,
  BG,
  FG,
  FONT_DISPLAY,
  PANEL,
  FAINT,
} from "@/components/v2/ui";

// Snapchat-y bottom nav: dark bg, dim icons, yellow underline on active.
// Center "STAKE" CTA is elevated like Snap's camera button.
const TABS = [
  { href: "/design/v2/feed", icon: Flame, label: "Feed" },
  { href: "/design/v2/chatter", icon: Radio, label: "Chatter" },
  // center is the action button — skip in tabs array, render explicitly
  { href: "/design/v2/portfolio", icon: PieChart, label: "Folio" },
  { href: "/design/v2/settings", icon: Settings, label: "Settings" },
];

export function V2BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t-2"
      style={{
        background: BG,
        borderColor: FAINT,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <div className="relative mx-auto flex max-w-md items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {TABS.slice(0, 2).map((t) => (
          <NavTab key={t.href} {...t} active={pathname === t.href} />
        ))}

        {/* Elevated center STAKE button */}
        <Link
          href="/design/v2/feed"
          className="relative flex flex-1 items-center justify-center"
          aria-label="Stake"
        >
          <span
            className="absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: ACCENT,
              color: BG,
              boxShadow: `0 8px 24px ${ACCENT}55, inset 0 -3px 0 rgba(0,0,0,0.18)`,
            }}
          >
            <Zap size={26} strokeWidth={3} fill={BG} />
          </span>
          <span
            className="pt-6 text-[10px] font-black uppercase tracking-widest"
            style={{ color: FG, opacity: 0.55 }}
          >
            Stake
          </span>
        </Link>

        {TABS.slice(2).map((t) => (
          <NavTab key={t.href} {...t} active={pathname === t.href} />
        ))}
      </div>
    </nav>
  );
}

function NavTab({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof Flame;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="relative flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-black uppercase tracking-widest"
      style={{
        color: FG,
        opacity: active ? 1 : 0.4,
      }}
    >
      <Icon size={20} strokeWidth={active ? 2.8 : 2.2} />
      <span>{label}</span>
      {active && (
        <span
          className="absolute bottom-0 left-1/2 h-1 w-8 -translate-x-1/2 rounded-t-full"
          style={{ background: ACCENT }}
        />
      )}
    </Link>
  );
}

export function V2Header({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <header
      className="sticky top-0 z-10 border-b-2 px-5 pt-5 pb-3"
      style={{ background: BG, borderColor: FAINT }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1
            className="font-black uppercase leading-none"
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: "30px",
              letterSpacing: "-0.03em",
              fontStretch: "condensed",
              color: FG,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="mt-1 text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: FG, opacity: 0.55, fontFamily: FONT_DISPLAY }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {trailing}
      </div>
    </header>
  );
}

export const PANEL_STYLE = {
  background: PANEL,
  borderRadius: 18,
  border: `1px solid ${FAINT}`,
};
