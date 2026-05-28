import { afterEach, describe, expect, it } from "vitest";
import { depositDevToolsVisible, feedRailPrefsVisible } from "./client-features";

const originalDepositDevTools = process.env.NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS;
const originalFeedRails = process.env.NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS;

describe("client feature flags", () => {
  afterEach(() => {
    if (originalDepositDevTools === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS = originalDepositDevTools;
    }

    if (originalFeedRails === undefined) {
      delete process.env.NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS;
    } else {
      process.env.NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS = originalFeedRails;
    }
  });

  it("hides deposit dev tools unless the public flag is enabled", () => {
    delete process.env.NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS;

    expect(depositDevToolsVisible()).toBe(false);

    process.env.NEXT_PUBLIC_FEATURE_DEPOSIT_DEV_TOOLS = "true";
    expect(depositDevToolsVisible()).toBe(true);
  });

  it("hides legacy feed rail preferences unless the public flag is enabled", () => {
    delete process.env.NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS;

    expect(feedRailPrefsVisible()).toBe(false);

    process.env.NEXT_PUBLIC_FEATURE_FEED_RAIL_PREFS = "true";
    expect(feedRailPrefsVisible()).toBe(true);
  });
});
