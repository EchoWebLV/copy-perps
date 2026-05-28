import { describe, expect, it } from "vitest";
import {
  buildProfileShareUrl,
  makeProfileCodeColorPattern,
  makeProfileCodePattern,
  PROFILE_CODE_COLORS,
  profileSharePath,
} from "./profile-code";
import type { ProfileCodeColor } from "./profile-code";

describe("profile share codes", () => {
  it("builds a handle share path without a duplicated @", () => {
    expect(profileSharePath("@fastbet_01")).toBe("/u/fastbet_01");
  });

  it("builds an absolute share URL from an app origin", () => {
    expect(buildProfileShareUrl("https://app.example", "fastbet_01")).toBe(
      "https://app.example/u/fastbet_01",
    );
  });

  it("generates a stable QR-like square pattern", () => {
    const first = makeProfileCodePattern("fastbet_01");
    const second = makeProfileCodePattern("fastbet_01");

    expect(first).toEqual(second);
    expect(first).toHaveLength(15);
    expect(first.every((row) => row.length === 15)).toBe(true);
    expect(first[0]?.[0]).toBe(true);
    expect(first[14]?.[14]).toBe(false);
  });

  it("generates stable colorful code cells from the app palette", () => {
    const first = makeProfileCodeColorPattern("fastbet_01");
    const second = makeProfileCodeColorPattern("fastbet_01");
    const activeColors = first
      .flat()
      .filter((color): color is ProfileCodeColor => color !== null);

    expect(first).toEqual(second);
    expect(first).toHaveLength(15);
    expect(first.every((row) => row.length === 15)).toBe(true);
    expect(first[14]?.[14]).toBeNull();
    expect(activeColors.every((color) => PROFILE_CODE_COLORS.includes(color))).toBe(
      true,
    );
    expect(new Set(activeColors).size).toBeGreaterThanOrEqual(3);
  });
});
