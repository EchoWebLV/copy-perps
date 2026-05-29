import {
  ChartCandlestick,
  Flame,
  PieChart,
  Settings,
  Zap,
} from "lucide-react";

export const DESKTOP_NAV_ITEMS = [
  { href: "/feed", label: "Whales", icon: Flame },
  { href: "/trade", label: "Scalp", icon: ChartCandlestick },
  { href: "/chatter", label: "Pulse", icon: Zap },
  { href: "/portfolio", label: "Folio", icon: PieChart },
  { href: "/deposit", label: "Settings", icon: Settings },
] as const;

export type DesktopNavItem = (typeof DESKTOP_NAV_ITEMS)[number];

export function isShellNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split("?")[0] ?? pathname;
  if (cleanPath === href) return true;
  return cleanPath.startsWith(`${href}/`);
}
