// lib/flash-v2/errors.test.ts
import { describe, expect, it } from "vitest";
import {
  normalizeFlashError,
  FlashWithdrawSettlingError,
  FlashOnboardingRequiredError,
} from "./errors";

describe("normalizeFlashError", () => {
  it("returns null when a 200 body has no err", () => {
    expect(normalizeFlashError({ httpStatus: 200, body: { ok: true } })).toBeNull();
  });
  it("classifies a 200 body.err string (trade/preview channel)", () => {
    const e = normalizeFlashError({ httpStatus: 200, body: { err: "something failed" } });
    expect(e).not.toBeNull();
    expect(e!.code).toBe("unknown");
  });
  it("maps 0xbc4 / AccountNotInitialized to a settling timing error", () => {
    const e = normalizeFlashError({ httpStatus: 500, body: "custom program error: 0xbc4" });
    expect(e).toBeInstanceOf(FlashWithdrawSettlingError);
  });
  it("maps a missing-basket message to onboarding required", () => {
    const e = normalizeFlashError({ httpStatus: 400, body: "basket account not initialized" });
    expect(e).toBeInstanceOf(FlashOnboardingRequiredError);
  });
  it("wraps a bare 500 as an unknown error", () => {
    const e = normalizeFlashError({ httpStatus: 500, body: "" });
    expect(e!.code).toBe("unknown");
  });
});
