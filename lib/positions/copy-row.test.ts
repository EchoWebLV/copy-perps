import { describe, expect, it } from "vitest";

import { formatCopySourceLabel } from "./copy-row";

describe("formatCopySourceLabel", () => {
  it("uses the whale name before bot and leader metadata", () => {
    expect(
      formatCopySourceLabel({
        whaleName: "Whale Alpha",
        botName: "Blitz",
        leaderUsername: "toptrader",
        leaderAddress: "9Gdmabcd1234efgh4kS",
      }),
    ).toBe("Whale Alpha");
  });

  it("uses the bot name for bot-driven tails without a leader address", () => {
    expect(
      formatCopySourceLabel({
        botName: "Blitz",
        leaderAddress: null,
        leaderUsername: null,
      }),
    ).toBe("Blitz");
  });

  it("uses a Pacifica username before truncating a leader address", () => {
    expect(
      formatCopySourceLabel({
        leaderUsername: "toptrader",
        leaderAddress: "9Gdmabcd1234efgh4kS",
      }),
    ).toBe("toptrader");
  });

  it("truncates wallet leader addresses", () => {
    expect(
      formatCopySourceLabel({
        leaderAddress: "9Gdmabcd1234efgh4kS",
      }),
    ).toBe("9Gdm...h4kS");
  });

  it("keeps the 0x prefix readable for Hyperliquid leader addresses", () => {
    expect(
      formatCopySourceLabel({
        leaderAddress: "0xf28e1b06e00e8774c612e31ab3ac35d5a720085f",
      }),
    ).toBe("0xf28e...085f");
  });

  it("falls back safely when old rows are missing source metadata", () => {
    expect(formatCopySourceLabel({})).toBe("Copy tail");
  });
});
