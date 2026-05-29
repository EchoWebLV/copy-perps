import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash fast perps game contract", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "components/trade/FastPerpsGame.tsx"), "utf8");

  it("uses Flash sizing with $1 stakes and 100x standard leverage", () => {
    const page = source();

    expect(page).toContain("FLASH PERPS");
    expect(page).toContain("FLASH_SCALP_MARKETS");
    expect(page).toContain(
      'const FLASH_SCALP_MARKETS = ["BTC", "ETH", "SOL"] as const',
    );
    expect(page).not.toContain("FLASH_MARKET_CATEGORIES");
    expect(page).not.toContain("categoryLabel");
    expect(page).not.toContain('button "Meme"');
    expect(page).toContain("flashLeverageOptionsForMarket");
    expect(page).toContain("const STAKES = [1, 5, 10, 50] as const");
    expect(page).not.toContain("const STAKES = [1, 2, 5, 10] as const");
    expect(page).not.toContain("FLASH_MARKETS.map");
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

  it("uses Privy session signers for TEE one-click Flash execution", () => {
    const page = source();

    expect(page).toContain("useSessionSigners");
    expect(page).toContain("addSessionSigners({");
    expect(page).toContain("NEXT_PUBLIC_PRIVY_FLASH_SIGNER_ID");
    expect(page).toContain("NEXT_PUBLIC_PRIVY_SIGNER_ID");
    expect(page).toContain("NEXT_PUBLIC_PRIVY_POLICY_IDS");
    expect(page).toContain("signerId: PRIVY_INSTANT_SIGNER_ID");
    expect(page).toContain("policyIds: PRIVY_INSTANT_POLICY_IDS");
    expect(page).toContain("PRIVY_INSTANT_TRADING_CONFIGURED");
    expect(page).toContain("return false");
    expect(page).toContain("requestOpen(useInstantExecution)");
    expect(page).toContain("requestClose(useInstantExecution)");
    expect(page).not.toContain("useDelegatedActions");
    expect(page).not.toContain("delegateWallet({");
    expect(page).not.toContain("Instant trading signer is not configured.");
    expect(page).toContain("ensureInstantTrading");
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

  it("drives Scalp PnL and graph from live Flash marks while reconciling exact positions slowly", () => {
    const page = source();

    expect(page).toContain("useFlashLiveMarks");
    expect(page).toContain("computeFlashLivePositionView");
    expect(page).toContain("FLASH_POSITION_RECONCILE_MS = 10_000");
    expect(page).toContain("positionViewsByKey");
    expect(page).toContain("selectedPositionView");
    expect(page).toContain("selectedPositionView.valueUsd");
    expect(page).toContain("selectedPositionView.pnlUsd");
    expect(page).toContain("selectedPositionView.exitValueUsd");
    expect(page).toContain("}, FLASH_POSITION_RECONCILE_MS)");
    expect(page).not.toContain("}, 2500)");
  });

  it("shows the selected Scalp P/L percentage next to the dollar loss", () => {
    const page = source();

    expect(page).toContain("function fmtSignedPct");
    expect(page).toContain("const roi = view?.roiPct ?? 0");
    expect(page).toContain("fmtSignedPct(roi)");
    expect(page).toContain("subvalue={selectedPosition ? fmtSignedPct(liveRoi) : undefined}");
    expect(page).toContain("fmtSignedPct(liveRoi)");
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
    expect(page).toContain("const exitValue = view?.exitValueUsd ?? 0");
    expect(page).toContain("selectedPositionView.exitValueUsd");
    expect(page).toContain("exit {fmtUsd(exitValue)}");
    expect(page).toContain("Exit {fmtUsd(exitValue)}");
    expect(page).not.toContain('label={selectedPosition ? "Collateral" : "Stake"}');
    expect(page).not.toContain("collat {fmtUsd(position.collateralUsd)}");
    expect(page).not.toContain('label={selectedPosition ? "Value" : "Stake"}');
  });

  it("shows the requested open leverage instead of refreshed effective leverage", () => {
    const page = source();

    expect(page).toContain("flashRequestedLeverageFromPosition");
    expect(page).toContain("function leverageForPosition");
    expect(page).toContain("leverageForPosition(position).toFixed(0)");
    expect(page).toContain("leverage: result.trade.leverage");
  });

  it("seeds a fallback entry snapshot for refreshed positions without open metadata", () => {
    const page = source();

    expect(page).toContain("seedFlashEntryCostCache");
    expect(page).toContain("const seeded = mergeFlashEntryCostCache");
    expect(page).toContain("setPositions(seeded)");
  });
});
