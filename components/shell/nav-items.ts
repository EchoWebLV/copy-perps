import {
  ChartCandlestick,
  Copy,
  Flame,
  Wallet,
  Zap,
} from "lucide-react";

export const DESKTOP_NAV_ITEMS = [
  { href: "/feed", label: "Traders", icon: Flame },
  // /portfolio is now framed as "Copies" — everything you're copying.
  { href: "/portfolio", label: "Copies", icon: Copy },
  { href: "/chatter", label: "Live", icon: Zap },
  { href: "/trade", label: "Trade", icon: ChartCandlestick },
  // The page at /deposit is wallet funding + withdrawals, not settings.
  { href: "/deposit", label: "Wallet", icon: Wallet },
] as const;

export type DesktopNavItem = (typeof DESKTOP_NAV_ITEMS)[number];

export function isShellNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split("?")[0] ?? pathname;
  if (cleanPath === href) return true;
  return cleanPath.startsWith(`${href}/`);
}
