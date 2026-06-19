import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getFlashV2Venue", () => {
  it("returns null when FEATURE_FLASH_V2 is off (default)", async () => {
    vi.stubEnv("FEATURE_FLASH_V2", "");
    vi.resetModules();
    const { getFlashV2Venue } = await import("./resolve");
    expect(getFlashV2Venue()).toBeNull();
  });

  it("returns a venue when FEATURE_FLASH_V2 is on", async () => {
    vi.stubEnv("FEATURE_FLASH_V2", "true");
    vi.resetModules();
    const { getFlashV2Venue } = await import("./resolve");
    const v = getFlashV2Venue();
    expect(v).not.toBeNull();
    expect(typeof v!.openPosition).toBe("function");
  });
});
