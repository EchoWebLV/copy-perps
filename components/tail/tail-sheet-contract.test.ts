import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readModal(): string {
  return readFileSync(
    join(process.cwd(), "components/tail/TailModal.tsx"),
    "utf8",
  );
}

describe("TailModal simplified copy sheet", () => {
  it("collapses a single/bot source to one context line (no Asset/Side/Mark grid)", () => {
    const source = readModal();

    // One honest line: asset · side · source leverage + entry/mark/liq + status.
    expect(source).toContain("contextStatus");
    expect(source).toContain("contextLiq");
    expect(source).toContain("× source");
    // The old three-up grid cell that restated side+copy-leverage is gone.
    expect(source).not.toContain("{displaySide} {displayLeverage}×");
  });

  it("keeps the leverage slider always visible (no Adjust collapse)", () => {
    const source = readModal();

    // Founder call: the leverage control must always be shown, not tucked
    // behind a tap.
    expect(source).not.toContain("showLeverageControl");
    expect(source).not.toContain("Adjust ⌄");
    // The full stepper + slider stays in the tree.
    expect(source).toContain("Decrease leverage");
    expect(source).toContain("Increase leverage");
    expect(source).toContain("Max {maxWhaleLeverage}x");
  });

  it("folds the 4-row summary into an inline line + CTA risk note for single/bot", () => {
    const source = readModal();

    // Inline order math under the stake input.
    expect(source).toContain("notional at");
    // Liq/buffer note under the button.
    expect(source).toContain("% buffer");
    // The full Notional/fee/buffer/following block only renders for bundles.
    expect(source).toContain("{isWhaleBundle ? (");
  });

  it("keeps the per-position list for multi-asset bundles only", () => {
    const source = readModal();

    // Bundles still get the scrollable list + the mix grid; single positions
    // do not (the context line covers them).
    expect(source).toContain("whaleTailPositionsHeading(whaleTailPositions)");
    expect(source).toContain(
      "multi-asset bundles need the scrollable per-position list",
    );
  });
});
