import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChartCandlestick, Zap } from "lucide-react";
import { describe, expect, it } from "vitest";
import { DESKTOP_NAV_ITEMS, isShellNavActive } from "./nav-items";

describe("desktop shell nav contract", () => {
  it("exposes the main app destinations in display order", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/feed",
      "/trade",
      "/chatter",
      "/portfolio",
      "/deposit",
    ]);
    // The /live heat + tape surfaces are gone — nothing should link there.
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).not.toContain("/live");
  });

  it("labels the main trading surfaces without legacy heat or bot roster copy", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Feed",
      "Scalp",
      "Pulse",
      "Folio",
      // /deposit is funding + withdrawals, so the tab says Wallet.
      "Wallet",
    ]);
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain(
      "Chatter",
    );
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain("Heat");
  });

  it("uses the same primary trade icons on desktop and mobile", () => {
    expect(DESKTOP_NAV_ITEMS.find((item) => item.label === "Scalp")?.icon).toBe(
      ChartCandlestick,
    );
    expect(DESKTOP_NAV_ITEMS.find((item) => item.label === "Pulse")?.icon).toBe(
      Zap,
    );
  });

  it("marks feed and trade nested paths active", () => {
    expect(isShellNavActive("/feed", "/feed")).toBe(true);
    expect(isShellNavActive("/feed", "/feed?bot=whale")).toBe(true);
    expect(isShellNavActive("/feed", "/feed/whale")).toBe(true);
    expect(isShellNavActive("/trade", "/trade?bot=whale")).toBe(true);
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
    expect(bottomNav).toContain('src="/nav-swipe-face-yellow.png"');
    // The mascot ring only lights up when Pulse is the active tab.
    expect(bottomNav).toContain("borderColor: pulseActive ? ACCENT");
    expect(bottomNav).not.toContain("<Zap size={26}");
    expect(bottomNav).not.toContain('aria-label="Swipe open positions"');
    expect(ChartCandlestick).toBeDefined();
  });

  it("keeps unfinished destinations out of the primary desktop nav", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).not.toContain(
      "/leaderboard",
    );
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
