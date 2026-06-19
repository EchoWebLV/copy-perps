import { describe, expect, it } from "vitest";
import { copyMetaVenue } from "./copy-meta";

describe("copyMetaVenue", () => {
  it("returns flash-v2 when meta.venue is flash-v2", () => {
    expect(copyMetaVenue({ venue: "flash-v2", leaderMarket: "SOL" })).toBe("flash-v2");
  });

  it("defaults legacy copy meta (no venue) to pacifica", () => {
    expect(copyMetaVenue({ leaderMarket: "SOL", leaderSide: "long" })).toBe("pacifica");
  });

  it("treats null / undefined / non-objects / explicit pacifica as pacifica", () => {
    expect(copyMetaVenue(null)).toBe("pacifica");
    expect(copyMetaVenue(undefined)).toBe("pacifica");
    expect(copyMetaVenue("flash-v2")).toBe("pacifica");
    expect(copyMetaVenue({ venue: "pacifica" })).toBe("pacifica");
    expect(copyMetaVenue({ venue: "flash" })).toBe("pacifica");
  });
});
