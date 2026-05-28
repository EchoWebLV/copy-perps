import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash fast perps game contract", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "components/trade/FastPerpsGame.tsx"), "utf8");

  it("uses Flash sizing with $1 stakes and 100x standard leverage", () => {
    const page = source();

    expect(page).toContain("FLASH PERPS");
    expect(page).toContain("const STAKES = [1, 5, 10, 50] as const");
    expect(page).not.toContain("const STAKES = [1, 2, 5, 10] as const");
    expect(page).toContain("const STANDARD_LEVERAGES = [20, 50, 100] as const");
    expect(page).toContain("Flash minimum position is $10 notional");
  });

  it("defaults manual Scalp to Flash Degen mode at 500x", () => {
    const page = source();

    expect(page).toContain('type TradeMode = "standard" | "degen"');
    expect(page).toContain("const DEGEN_LEVERAGES = [125, 250, 500] as const");
    expect(page).toContain('useState<TradeMode>("degen")');
    expect(page).toContain("useState(500)");
    expect(page).toContain("mode: tradeMode");
    expect(page).toContain('result.phase === "sent"');
    expect(page).toContain('`${side.toUpperCase()} ${market} ${leverage}x`');
  });

  it("opens and closes through Flash routes with user-signed transactions", () => {
    const page = source();

    expect(page).toContain('fetch("/api/flash/perp"');
    expect(page).toContain('fetch("/api/flash/perp/positions"');
    expect(page).toContain("signAndSendFlashTransaction");
    expect(page).toContain("transactionB64");
  });

  it("uses Privy delegation for one-click Flash execution after first approval", () => {
    const page = source();

    expect(page).toContain("useDelegatedActions");
    expect(page).toContain("delegateWallet({");
    expect(page).toContain("ensureInstantTrading");
    expect(page).toContain("requestOpen(true)");
    expect(page).toContain("requestClose(true)");
    expect(page).toContain('result.phase === "sent"');
    expect(page).toContain('result.phase === "sent-close"');
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

  it("shows the user stake separately from Flash posted collateral", () => {
    const page = source();

    expect(page).toContain("flashStakeUsdFromPosition");
    expect(page).toContain("stakeForPosition(selectedPosition)");
    expect(page).toContain('label="Stake"');
    expect(page).toContain('label={selectedPosition ? "P/L" : "Notional"}');
    expect(page).toContain("stake {fmtUsd(stakeForPosition(position))}");
    expect(page).toContain("const exitValue = exitValueForPosition(position)");
    expect(page).toContain("exit {fmtUsd(exitValue)}");
    expect(page).toContain("Exit {fmtUsd(exitValue)}");
    expect(page).not.toContain('label={selectedPosition ? "Collateral" : "Stake"}');
    expect(page).not.toContain("collat {fmtUsd(position.collateralUsd)}");
    expect(page).not.toContain('label={selectedPosition ? "Value" : "Stake"}');
  });
});
