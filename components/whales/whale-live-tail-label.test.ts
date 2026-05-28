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

  it("labels stale positions as snapshot-copyable", () => {
    expect(
      buildWhaleLiveTailButtonLabel({
        stale: true,
      }),
    ).toBe("COPY SNAPSHOT");
  });

  it("shows when a source market cannot route through Flash", () => {
    expect(
      buildWhaleLiveTailButtonLabel({
        stale: false,
        copyableOnPacifica: false,
      }),
    ).toBe("FLASH UNAVAILABLE");
  });

  it("keeps unsupported stale markets unavailable", () => {
    expect(
      buildWhaleLiveTailButtonLabel({
        stale: true,
        copyableOnPacifica: false,
      }),
    ).toBe("FLASH UNAVAILABLE");
  });
});
