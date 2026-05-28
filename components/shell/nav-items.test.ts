import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChartCandlestick, Radio, Zap } from "lucide-react";
import { describe, expect, it } from "vitest";
import { DESKTOP_NAV_ITEMS, isShellNavActive } from "./nav-items";

describe("desktop shell nav contract", () => {
  it("exposes the main app destinations in display order", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/feed",
      "/chatter",
      "/live",
      "/portfolio",
      "/deposit",
      "/leaderboard",
    ]);
  });

  it("labels the main whale trading surfaces without legacy bot roster copy", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Whales",
      "Pulse",
      "Heat",
      "Portfolio",
      "Settings",
      "Wins",
    ]);
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain(
      "Chatter",
    );
  });

  it("uses the Pulse and Heat icons without changing their routes", () => {
    expect(DESKTOP_NAV_ITEMS.find((item) => item.label === "Pulse")?.icon).toBe(
      Zap,
    );
    expect(DESKTOP_NAV_ITEMS.find((item) => item.label === "Heat")?.icon).toBe(
      Radio,
    );
  });

  it("marks feed and live nested paths active", () => {
    expect(isShellNavActive("/feed", "/feed")).toBe(true);
    expect(isShellNavActive("/feed", "/feed?bot=whale")).toBe(true);
    expect(isShellNavActive("/feed", "/feed/whale")).toBe(true);
    expect(isShellNavActive("/live", "/live?bot=whale")).toBe(true);
  });

  it("puts Pulse on the elevated mobile shortcut and benches Heat for Scalp", () => {
    const bottomNav = readFileSync(
      join(process.cwd(), "components/shell/BottomNav.tsx"),
      "utf8",
    );

    expect(bottomNav).toContain(
      '{ href: "/trade", icon: ChartCandlestick, label: "Scalp" }',
    );
    expect(bottomNav).not.toContain('label: "Heat"');
    expect(bottomNav).not.toContain('href: "/live"');
    expect(bottomNav).toContain("pathname.startsWith(\"/trade\")");
    expect(bottomNav).toContain('href="/chatter"');
    expect(bottomNav).toContain('aria-label="Pulse open positions"');
    expect(bottomNav).toContain("<Zap size={26}");
    expect(bottomNav).not.toContain('aria-label="Swipe open positions"');
    expect(ChartCandlestick).toBeDefined();
  });

  it("does not mark unrelated destinations active", () => {
    expect(isShellNavActive("/feed", null)).toBe(false);
    expect(isShellNavActive("/feed", "/portfolio")).toBe(false);
    expect(isShellNavActive("/deposit", "/leaderboard")).toBe(false);
  });

  it("does not eagerly prefetch heavyweight app destinations from shell nav", () => {
    const desktopNav = readFileSync(
      join(process.cwd(), "components/shell/DesktopNav.tsx"),
      "utf8",
    );
    const bottomNav = readFileSync(
      join(process.cwd(), "components/shell/BottomNav.tsx"),
      "utf8",
    );

    expect(
      desktopNav.match(/prefetch={false}/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(
      bottomNav.match(/prefetch={false}/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });
});
