import { describe, expect, it } from "vitest";
import { DESKTOP_NAV_ITEMS, isShellNavActive } from "./nav-items";

describe("desktop shell nav contract", () => {
  it("exposes the main app destinations in display order", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/feed",
      "/live",
      "/chatter",
      "/portfolio",
      "/deposit",
      "/leaderboard",
    ]);
  });

  it("labels the main whale trading surfaces without legacy bot roster copy", () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Whales",
      "Swipe",
      "Pulse",
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

  it("does not mark unrelated destinations active", () => {
    expect(isShellNavActive("/feed", null)).toBe(false);
    expect(isShellNavActive("/feed", "/portfolio")).toBe(false);
    expect(isShellNavActive("/deposit", "/leaderboard")).toBe(false);
  });
});
