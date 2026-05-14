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
      values: insertMock,
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
