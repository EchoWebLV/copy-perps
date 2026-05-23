import { afterEach, describe, expect, it } from "vitest";
import { whaleSocialEnabled } from "./features";

const originalWhaleSocial = process.env.FEATURE_WHALE_SOCIAL;

describe("feature flags", () => {
  afterEach(() => {
    if (originalWhaleSocial === undefined) {
      delete process.env.FEATURE_WHALE_SOCIAL;
    } else {
      process.env.FEATURE_WHALE_SOCIAL = originalWhaleSocial;
    }
  });

  it("keeps the whale social platform enabled unless explicitly disabled", () => {
    delete process.env.FEATURE_WHALE_SOCIAL;

    expect(whaleSocialEnabled()).toBe(true);
  });

  it("allows the whale social platform to be explicitly disabled", () => {
    process.env.FEATURE_WHALE_SOCIAL = "false";

    expect(whaleSocialEnabled()).toBe(false);
  });
});
