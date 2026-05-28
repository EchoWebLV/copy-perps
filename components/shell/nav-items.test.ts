import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      "Swipe",
      "Portfolio",
      "Settings",
      "Wins",
    ]);
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).not.toContain(
      "Chatter",
    );
  });

  it("marks feed and live nested paths active", () => {
    expect(isShellNavActive("/feed", "/feed")).toBe(true);
    expect(isShellNavActive("/feed", "/feed?bot=whale")).toBe(true);
    expect(isShellNavActive("/feed", "/feed/whale")).toBe(true);
    expect(isShellNavActive("/live", "/live?bot=whale")).toBe(true);
  });

  it("puts Pulse on the elevated mobile shortcut and keeps Swipe as a tab", () => {
    const bottomNav = readFileSync(
      join(process.cwd(), "components/shell/BottomNav.tsx"),
      "utf8",
    );

    expect(bottomNav).toContain(
      '{ href: "/live", icon: Zap, label: "Swipe" }',
    );
    expect(bottomNav).toContain('href="/chatter"');
    expect(bottomNav).toContain('aria-label="Pulse open positions"');
    expect(bottomNav).toContain("<Radio size={26}");
    expect(bottomNav).not.toContain('aria-label="Swipe open positions"');
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
