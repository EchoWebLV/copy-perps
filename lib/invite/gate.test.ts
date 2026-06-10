import { describe, expect, it } from "vitest";
import {
  inviteCookieToken,
  isGatedPath,
  isValidInviteCode,
} from "./gate";

const SHA256_GWAKGWAK =
  "acf93821111bcb36cc9e3964855e5ed03e4c6695f86c322a5aba0f2d31106360";

describe("invite gate helpers", () => {
  describe("isValidInviteCode", () => {
    it("accepts the configured code", () => {
      expect(isValidInviteCode("gwakgwak")).toBe(true);
    });

    it("is case-insensitive and trims surrounding whitespace", () => {
      expect(isValidInviteCode("  GwakGwak  ")).toBe(true);
    });

    it("rejects a wrong code", () => {
      expect(isValidInviteCode("nope")).toBe(false);
    });

    it("rejects empty input", () => {
      expect(isValidInviteCode("")).toBe(false);
    });
  });

  describe("inviteCookieToken", () => {
    it("is the sha256 hex of the code, not the raw code", async () => {
      const token = await inviteCookieToken();
      expect(token).toBe(SHA256_GWAKGWAK);
      expect(token).not.toContain("gwak");
      expect(token).toHaveLength(64);
    });
  });

  describe("isGatedPath", () => {
    it("gates app pages", () => {
      expect(isGatedPath("/feed")).toBe(true);
      expect(isGatedPath("/trade")).toBe(true);
      expect(isGatedPath("/api/whales/roster")).toBe(true);
    });

    it("never gates the public landing page", () => {
      expect(isGatedPath("/")).toBe(false);
    });

    it("never gates the invite screen, its API, or the waitlist API", () => {
      expect(isGatedPath("/invite")).toBe(false);
      expect(isGatedPath("/api/invite")).toBe(false);
      expect(isGatedPath("/api/waitlist")).toBe(false);
    });

    it("never gates the Railway healthcheck or cron triggers", () => {
      expect(isGatedPath("/api/health")).toBe(false);
      expect(isGatedPath("/api/cron/refresh-whales")).toBe(false);
    });

    it("never gates next internals or static files", () => {
      expect(isGatedPath("/_next/static/chunk.js")).toBe(false);
      expect(isGatedPath("/favicon.ico")).toBe(false);
      expect(isGatedPath("/manifest.webmanifest")).toBe(false);
    });
  });
});
