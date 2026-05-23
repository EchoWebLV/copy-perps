import { describe, expect, it } from "vitest";
import {
  buildWhaleFingerprintAvatarModel,
  WHALE_FINGERPRINT_GRID_SIZE,
} from "./whale-fingerprint";

describe("buildWhaleFingerprintAvatarModel", () => {
  it("generates a stable wallet fingerprint for the same source account", () => {
    const wallet = "0x8a9f0a817d1beefcafed00d1234567890abcdef";

    expect(buildWhaleFingerprintAvatarModel(wallet)).toEqual(
      buildWhaleFingerprintAvatarModel(wallet),
    );
  });

  it("changes the colored fingerprint for different source accounts", () => {
    const first = buildWhaleFingerprintAvatarModel("0x1111111111111111");
    const second = buildWhaleFingerprintAvatarModel("0x2222222222222222");

    expect(first).not.toEqual(second);
    expect(first.colors.primary).not.toEqual(second.colors.primary);
  });

  it("includes QR-style finder anchors and colored data modules", () => {
    const model = buildWhaleFingerprintAvatarModel("0xabc");
    const finderCells = model.cells.filter((cell) => cell.role === "finder");
    const dataCells = model.cells.filter((cell) => cell.role === "data");
    const finderKeys = new Set(
      finderCells.map((cell) => `${cell.col}:${cell.row}`),
    );

    expect(finderKeys.has("0:0")).toBe(true);
    expect(finderKeys.has(`${WHALE_FINGERPRINT_GRID_SIZE - 1}:0`)).toBe(true);
    expect(finderKeys.has(`0:${WHALE_FINGERPRINT_GRID_SIZE - 1}`)).toBe(true);
    expect(dataCells.length).toBeGreaterThan(80);
    expect(new Set(dataCells.map((cell) => cell.color)).size).toBeGreaterThan(1);
  });
});
