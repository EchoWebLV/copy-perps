import { describe, expect, it } from "vitest";
import { buildWhaleLiveTailButtonLabel } from "./whale-live-tail-label";

describe("buildWhaleLiveTailButtonLabel", () => {
  it("labels the swipe CTA as a position action", () => {
    expect(
      buildWhaleLiveTailButtonLabel({
        stale: false,
      }),
    ).toBe("TAIL THIS POSITION");
  });

  it("keeps stale positions disabled", () => {
    expect(
      buildWhaleLiveTailButtonLabel({
        stale: true,
      }),
    ).toBe("TAIL DISABLED");
  });

  it("shows when a Hyperliquid source market cannot route through Pacifica", () => {
    expect(
      buildWhaleLiveTailButtonLabel({
        stale: false,
        copyableOnPacifica: false,
      }),
    ).toBe("PACIFICA UNAVAILABLE");
  });
});
