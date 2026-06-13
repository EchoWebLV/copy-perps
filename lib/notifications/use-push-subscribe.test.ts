// lib/notifications/use-push-subscribe.test.ts
//
// Tests for the urlBase64ToUint8Array helper only — the hook itself requires
// a DOM/browser environment and is not exercised here.

import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./use-push-subscribe";

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
