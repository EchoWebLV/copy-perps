import { describe, expect, it } from "vitest";
import { mergeHyperliquidRoster } from "./hyperliquid-roster";

describe("mergeHyperliquidRoster", () => {
  it("keeps curated whales first, then pinned, then discovered", () => {
    const r = mergeHyperliquidRoster(
      [{ address: "0xAAA" }, { address: "0xBBB" }],
      [{ address: "0xCCC" }],
      [{ address: "0xDDD" }],
      10,
    );
    expect(r.map((w) => w.address)).toEqual([
      "0xAAA",
      "0xBBB",
      "0xCCC",
      "0xDDD",
    ]);
  });

  it("dedupes by address case-insensitively, preferring the earlier (curated) entry", () => {
    const r = mergeHyperliquidRoster(
      [{ address: "0xAAA", label: "Curated A" }],
      [],
      [{ address: "0xaaa", label: "Discovered A" }, { address: "0xBBB" }],
      10,
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ address: "0xAAA", label: "Curated A" });
    expect(r[1]).toEqual({ address: "0xBBB" });
  });

  it("caps the merged roster, never dropping curated whales", () => {
    const curated = Array.from({ length: 55 }, (_, i) => ({
      address: `0xc${i}`,
    }));
    const discovered = Array.from({ length: 50 }, (_, i) => ({
      address: `0xd${i}`,
    }));
    const r = mergeHyperliquidRoster(curated, [], discovered, 70);
    expect(r).toHaveLength(70);
    expect(r.slice(0, 55)).toEqual(curated); // all curated survive the cap
    expect(r[55]?.address).toBe("0xd0"); // then discovered fill the rest
  });

  it("handles null discovery (fallback to curated only)", () => {
    const r = mergeHyperliquidRoster(
      [{ address: "0xAAA" }],
      [],
      null,
      70,
    );
    expect(r.map((w) => w.address)).toEqual(["0xAAA"]);
  });
});
