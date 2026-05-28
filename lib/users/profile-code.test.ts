import { describe, expect, it } from "vitest";
import {
  buildProfileShareUrl,
  makeProfileCodePattern,
  profileSharePath,
} from "./profile-code";

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
});
