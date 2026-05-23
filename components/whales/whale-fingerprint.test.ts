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

  it("includes QR-style finder anchors and wallet-colored data modules", () => {
    const model = buildWhaleFingerprintAvatarModel("0xabc");
    const finderCells = model.cells.filter((cell) => cell.role === "finder");
    const dataCells = model.cells.filter((cell) => cell.role === "data");
    const finderKeys = new Set(
      finderCells.map((cell) => `${cell.col}:${cell.row}`),
    );

    expect(finderKeys.has("0:0")).toBe(true);
    expect(finderKeys.has(`${WHALE_FINGERPRINT_GRID_SIZE - 1}:0`)).toBe(true);
    expect(finderKeys.has(`0:${WHALE_FINGERPRINT_GRID_SIZE - 1}`)).toBe(true);
    expect(dataCells.length).toBeGreaterThan(45);
    expect(new Set(dataCells.map((cell) => cell.color))).toEqual(
      new Set([model.colors.primary]),
    );
  });

  it("keeps the generated code inside an exact 16 by 16 module grid", () => {
    const model = buildWhaleFingerprintAvatarModel("0xabc");
    const cols = model.cells.map((cell) => cell.col);
    const rows = model.cells.map((cell) => cell.row);
    const dataColors = new Set(
      model.cells
        .filter((cell) => cell.role === "data")
        .map((cell) => cell.color),
    );

    expect(Math.min(...cols)).toBe(0);
    expect(Math.max(...cols)).toBe(WHALE_FINGERPRINT_GRID_SIZE - 1);
    expect(Math.min(...rows)).toBe(0);
    expect(Math.max(...rows)).toBe(WHALE_FINGERPRINT_GRID_SIZE - 1);
    expect(dataColors).toEqual(new Set([model.colors.primary]));
  });
});
