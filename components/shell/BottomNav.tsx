"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChartCandlestick, Flame, Wallet, PieChart } from "lucide-react";
import { ACCENT, BG, FG, FAINT, FONT_DISPLAY } from "@/components/v2/ui";

// Snap-style: dark bg, dim icons, yellow underline on active. Center
// Pulse CTA elevates above the bar like the camera button in Snapchat.
const LEFT_TABS = [
  { href: "/feed", icon: Flame, label: "Whales" },
  { href: "/trade", icon: ChartCandlestick, label: "Scalp" },
];
const RIGHT_TABS = [
  { href: "/arena", icon: Bot, label: "Arena" },
  { href: "/portfolio", icon: PieChart, label: "Folio" },
  // The page at /deposit is wallet funding + withdrawals, not settings.
  { href: "/deposit", icon: Wallet, label: "Wallet" },
];

export function BottomNav() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (!pathname) return false;
    if (pathname === href) return true;
    if (href === "/feed" && pathname.startsWith("/feed")) return true;
    if (href === "/trade" && pathname.startsWith("/trade")) return true;
    if (href === "/chatter" && pathname.startsWith("/chatter")) return true;
    return false;
  }

  const pulseActive = isActive("/chatter");

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t-2 lg:hidden"
      style={{
        background: BG,
        borderColor: FAINT,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <div className="relative mx-auto flex max-w-md items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {LEFT_TABS.map((t) => (
          <NavTab key={t.href} {...t} active={isActive(t.href)} />
        ))}

        {/* Elevated center Pulse shortcut. */}
        <Link
          href="/chatter"
          prefetch={false}
          className="relative flex flex-1 items-center justify-center"
          aria-label="Pulse open positions"
        >
          <span
            className="absolute -top-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-[3px]"
            style={{
              background: BG,
              // Only the active tab gets the full acid ring + glow —
              // otherwise the mascot reads as "you are here" on every page.
              borderColor: pulseActive ? ACCENT : `${ACCENT}55`,
              boxShadow: pulseActive
                ? `0 8px 28px ${ACCENT}99, inset 0 -3px 0 rgba(0,0,0,0.18)`
                : `0 6px 18px rgba(0,0,0,0.55), inset 0 -3px 0 rgba(0,0,0,0.18)`,
              transform: pulseActive ? "scale(1.05)" : "scale(1)",
              opacity: pulseActive ? 1 : 0.82,
              transition: "transform 200ms, box-shadow 200ms, opacity 200ms",
            }}
          >
            <Image
              src="/nav-swipe-face-yellow.png"
              alt=""
              width={56}
              height={56}
              sizes="56px"
              className="h-full w-full object-cover"
            />
          </span>
          <span
            className="pt-6 text-[10px] font-black uppercase tracking-widest"
            style={{ color: FG, opacity: pulseActive ? 1 : 0.55 }}
          >
            Pulse
          </span>
        </Link>

        {RIGHT_TABS.map((t) => (
          <NavTab key={t.href} {...t} active={isActive(t.href)} />
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
      prefetch={false}
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
