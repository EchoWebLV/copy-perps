import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash fast perps game contract", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "components/trade/FastPerpsGame.tsx"), "utf8");

  it("uses Flash sizing with $1 stakes and 100x leverage", () => {
    const page = source();

    expect(page).toContain("FLASH PERPS");
    expect(page).toContain("const STAKES = [1, 2, 5, 10] as const");
    expect(page).toContain("const LEVERAGES = [20, 50, 100] as const");
    expect(page).toContain("Flash minimum position is $10 notional");
  });

  it("opens and closes through Flash routes with user-signed transactions", () => {
    const page = source();

    expect(page).toContain('fetch("/api/flash/perp"');
    expect(page).toContain('fetch("/api/flash/perp/positions"');
    expect(page).toContain("signAndSendFlashTransaction");
    expect(page).toContain("transactionB64");
  });

  it("renders the old game-style live graph on the trade screen", () => {
    const page = source();

    expect(page).toContain("function LivePerpGraph");
    expect(page).toContain("<svg");
    expect(page).toContain("entryValue");
    expect(page).toContain("MAX_GRAPH_POINTS");
  });

  it("keeps the mobile trade controls compact without an empty graph placeholder", () => {
    const page = source();

    expect(page).toContain("overflow-hidden px-4 pt-3");
    expect(page).not.toContain("overflow-y-auto px-5 pt-5");
    expect(page).toContain("{selectedPosition && (");
    expect(page).not.toContain("Open a Flash position for live graph");
    expect(page).toContain("pb-[calc(88px+env(safe-area-inset-bottom))]");
  });
});
