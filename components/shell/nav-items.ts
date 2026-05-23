import { Flame, Radio, PieChart, Settings, Trophy, Zap } from "lucide-react";

export const DESKTOP_NAV_ITEMS = [
  { href: "/feed", label: "Whales", icon: Flame },
  { href: "/live", label: "Swipe", icon: Zap },
  { href: "/chatter", label: "Chatter", icon: Radio },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/deposit", label: "Settings", icon: Settings },
  { href: "/leaderboard", label: "Wins", icon: Trophy },
] as const;

export type DesktopNavItem = (typeof DESKTOP_NAV_ITEMS)[number];

export function isShellNavActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  const cleanPath = pathname.split("?")[0] ?? pathname;
  if (cleanPath === href) return true;
  return cleanPath.startsWith(`${href}/`);
}
