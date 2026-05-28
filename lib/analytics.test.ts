import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: mocks,
}));

describe("analytics client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubGlobal("window", {
      location: { origin: "https://example.test" },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps analytics traffic off the Railway app server by default", async () => {
    const { initPostHog } = await import("@/lib/analytics");

    initPostHog();

    expect(mocks.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://us.i.posthog.com",
        autocapture: false,
        capture_pageleave: false,
      }),
    );
  });

  it("allows an explicit PostHog proxy host when needed", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_API_HOST", "/ingest");
    const { initPostHog } = await import("@/lib/analytics");

    initPostHog();

    expect(mocks.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "/ingest",
      }),
    );
  });
});
