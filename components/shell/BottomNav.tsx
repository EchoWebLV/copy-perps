"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Settings, PieChart } from "lucide-react";

// /leaderboard exists but is not exposed in the nav yet — pre-launch
// hide while we polish the shared-card flow. Re-add the Trophy entry
// here when ready.
const tabs = [
  { href: "/feed", icon: Flame, label: "Feed" },
  { href: "/portfolio", icon: PieChart, label: "Portfolio" },
  { href: "/deposit", icon: Settings, label: "Settings" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/5 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-md items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href === "/feed" && pathname?.startsWith("/feed"));
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-semibold uppercase tracking-wider transition ${
                active ? "text-white" : "text-neutral-500"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
