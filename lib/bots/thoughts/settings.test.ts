import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const selectMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectMock(),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoNothing: () => insertMock(v),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => updateMock(patch),
      }),
    }),
  },
}));

import { getThoughtSettings, updateThoughtSettings } from "./settings";

describe("getThoughtSettings", () => {
  beforeEach(() => {
    insertMock.mockReset();
    selectMock.mockReset();
    updateMock.mockReset();
  });

  it("returns the row when one exists", async () => {
    selectMock.mockResolvedValueOnce([
      { id: "singleton", enableNearTrade: true, enableBanter: false },
    ]);
    const s = await getThoughtSettings();
    expect(s.enableNearTrade).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("creates and returns defaults when no row exists", async () => {
    selectMock
      .mockResolvedValueOnce([]) // first read: missing
      .mockResolvedValueOnce([
        {
          id: "singleton",
          enableNearTrade: false,
          enableBanter: false,
          enableMarketReact: false,
          enablePositionColor: false,
          enableMoodBadges: true,
        },
      ]);
    insertMock.mockResolvedValueOnce(undefined);
    const s = await getThoughtSettings();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(s.enableMoodBadges).toBe(true);
    expect(s.enableNearTrade).toBe(false);
  });

  it("survives a concurrent insert (onConflictDoNothing)", async () => {
    // First caller's read returns empty; insert "wins" silently (onConflictDoNothing
    // swallows the unique-violation from a concurrent writer); the re-read
    // returns whatever row exists.
    selectMock
      .mockResolvedValueOnce([]) // first read: missing
      .mockResolvedValueOnce([
        {
          id: "singleton",
          enableNearTrade: false,
          enableMoodBadges: true,
        },
      ]);
    insertMock.mockResolvedValueOnce(undefined);
    const s = await getThoughtSettings();
    expect(s.enableMoodBadges).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe("updateThoughtSettings", () => {
  beforeEach(() => updateMock.mockReset());

  it("forwards the patch", async () => {
    updateMock.mockResolvedValueOnce(undefined);
    await updateThoughtSettings({ enableNearTrade: true });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ enableNearTrade: true }),
    );
  });
});
