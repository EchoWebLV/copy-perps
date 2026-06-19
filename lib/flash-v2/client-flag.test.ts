import { afterEach, describe, expect, it } from "vitest";
import { isFlashV2Client } from "./client-flag";

const original = process.env.NEXT_PUBLIC_FEATURE_FLASH_V2;

describe("isFlashV2Client", () => {
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_FEATURE_FLASH_V2;
    else process.env.NEXT_PUBLIC_FEATURE_FLASH_V2 = original;
  });

  it("is true only for the exact string 'true'", () => {
    process.env.NEXT_PUBLIC_FEATURE_FLASH_V2 = "true";
    expect(isFlashV2Client()).toBe(true);
  });

  it("defaults to false (stay on Flash v1) when unset or any other value", () => {
    delete process.env.NEXT_PUBLIC_FEATURE_FLASH_V2;
    expect(isFlashV2Client()).toBe(false);
    process.env.NEXT_PUBLIC_FEATURE_FLASH_V2 = "1";
    expect(isFlashV2Client()).toBe(false);
    process.env.NEXT_PUBLIC_FEATURE_FLASH_V2 = "TRUE";
    expect(isFlashV2Client()).toBe(false);
  });
});
