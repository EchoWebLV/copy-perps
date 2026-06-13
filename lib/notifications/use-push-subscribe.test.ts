// lib/notifications/use-push-subscribe.test.ts
//
// Tests for the urlBase64ToUint8Array helper and the deriveToggleState pure
// helper. The hook itself requires a DOM/browser environment and is not
// exercised here.

import { describe, expect, it } from "vitest";
import {
  urlBase64ToUint8Array,
  deriveToggleState,
} from "./use-push-subscribe";

// ── urlBase64ToUint8Array ─────────────────────────────────────────────────────

describe("urlBase64ToUint8Array", () => {
  it("converts a URL-safe base64 string to Uint8Array", () => {
    // "hello" in standard base64 is "aGVsbG8="
    const result = urlBase64ToUint8Array("aGVsbG8=");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]); // "hello"
  });

  it("handles URL-safe characters: - and _ correctly", () => {
    // Standard base64 for bytes [0xfb, 0xff] is "+/8=" ; URL-safe is "-_8="
    const result = urlBase64ToUint8Array("-_8=");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result[0]).toBe(0xfb);
    expect(result[1]).toBe(0xff);
  });

  it("handles missing padding (VAPID keys are typically unpadded)", () => {
    // VAPID public keys are 65 bytes encoded without padding
    // Use a 3-byte string that has no padding in base64: "YWJj" = "abc"
    const result = urlBase64ToUint8Array("YWJj");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([97, 98, 99]); // "abc"
  });

  it("decodes a realistic VAPID-length public key without throwing", () => {
    // Real VAPID public key from the project (65 bytes → 87 base64 chars)
    const vapidPubKey =
      "BCT79F-HYsq81MMn2aHNILDiMdyrVhygmrRrYfPvUy22j5lQom9Jl7Z-mINSOKZmXTVJZe1iT2lzbnAT4Y5tRBE";
    const result = urlBase64ToUint8Array(vapidPubKey);
    expect(result).toBeInstanceOf(Uint8Array);
    // P-256 uncompressed public key is always 65 bytes
    expect(result.length).toBe(65);
  });

  it("returns empty Uint8Array for empty string", () => {
    const result = urlBase64ToUint8Array("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });
});

// ── deriveToggleState ─────────────────────────────────────────────────────────

describe("deriveToggleState", () => {
  // Helpers for concise fixture construction.
  const base = {
    supported: true,
    permission: "default" as NotificationPermission,
    subscribed: false,
    subscribing: false,
    error: null,
  };

  it('returns "unsupported" when push is not available regardless of other fields', () => {
    expect(
      deriveToggleState({ ...base, supported: false, permission: "granted", subscribed: true }),
    ).toBe("unsupported");
  });

  it('returns "blocked" when permission is denied', () => {
    expect(deriveToggleState({ ...base, permission: "denied" })).toBe("blocked");
  });

  it('returns "enabling" when subscribing is in progress', () => {
    expect(deriveToggleState({ ...base, subscribing: true })).toBe("enabling");
  });

  it('"enabling" takes precedence over an existing error (in-flight overrides stale error)', () => {
    expect(
      deriveToggleState({ ...base, subscribing: true, error: "previous error" }),
    ).toBe("enabling");
  });

  it('returns "error" when there is an error and not subscribing', () => {
    expect(
      deriveToggleState({ ...base, error: "SW timeout" }),
    ).toBe("error");
  });

  it('returns "on" when permission is granted AND subscribed is true', () => {
    expect(
      deriveToggleState({ ...base, permission: "granted", subscribed: true }),
    ).toBe("on");
  });

  it('returns "enable" when permission is granted but subscribed is false (the false-ON bug case)', () => {
    // This is the core bug fix: permission-granted ≠ subscription-persisted.
    expect(
      deriveToggleState({ ...base, permission: "granted", subscribed: false }),
    ).toBe("enable");
  });

  it('returns "enable" when permission is default and nothing is in flight', () => {
    expect(deriveToggleState({ ...base })).toBe("enable");
  });

  it('"blocked" takes precedence over subscribed=true (defensive: revoked after subscribe)', () => {
    expect(
      deriveToggleState({ ...base, permission: "denied", subscribed: true }),
    ).toBe("blocked");
  });

  it('"on" requires both granted AND subscribed — not just subscribed', () => {
    // subscribed=true but permission=default should not show "on"
    expect(
      deriveToggleState({ ...base, permission: "default", subscribed: true }),
    ).toBe("enable");
  });
});
