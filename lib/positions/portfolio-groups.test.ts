import { describe, expect, it } from "vitest";
import type { EnrichedPosition } from "./enrich";
import { splitPortfolioPositions } from "./portfolio-groups";

function position(
  patch: Partial<EnrichedPosition> & Pick<EnrichedPosition, "id" | "type" | "status">,
): EnrichedPosition {
  return {
    amountUsdc: 5,
    createdAt: "2026-05-25T17:00:00.000Z",
    ...patch,
  };
}

describe("splitPortfolioPositions", () => {
  it("keeps open copy trades out of the generic open list", () => {
    const { openPositions, closedPositions } = splitPortfolioPositions([
      position({ id: "open-copy", type: "copy", status: "confirmed" }),
      position({ id: "open-perp", type: "perp", status: "confirmed" }),
    ]);

    expect(openPositions.map((p) => p.id)).toEqual(["open-perp"]);
    expect(closedPositions).toEqual([]);
  });

  it("keeps closed copy trades in the closed list", () => {
    const { openPositions, closedPositions } = splitPortfolioPositions([
      position({ id: "closed-copy", type: "copy", status: "closed" }),
      position({ id: "closed-perp", type: "perp", status: "closed" }),
    ]);

    expect(openPositions).toEqual([]);
    expect(closedPositions.map((p) => p.id)).toEqual([
      "closed-copy",
      "closed-perp",
    ]);
  });
});
