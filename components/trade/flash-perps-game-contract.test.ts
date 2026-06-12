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

  it("defaults manual Scalp to standard mode at 20x — degen is opt-in", () => {
    const page = source();

    expect(page).toContain('type TradeMode = "standard" | "degen"');
    expect(page).toContain("const DEGEN_LEVERAGES = [125, 250, 500] as const");
    // New safe default: standard 20x (not degen 500x).
    expect(page).toContain('useState<TradeMode>("standard")');
    expect(page).toContain("useState(20)");
    expect(page).not.toContain('useState<TradeMode>("degen")');
    expect(page).not.toContain("useState(500)");
    expect(page).toContain("mode: tradeMode");
    expect(page).toContain('result.phase === "sent"');
    expect(page).toContain('`${side.toUpperCase()} ${market} ${leverage}x`');
    // Liquidation warning shown for all degen leverages (≥125x).
    expect(page).toContain("leverage >= 125");
    expect(page).toContain("(100 / leverage).toFixed(2)}% move against you liquidates.");
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

  it("renders the money-channel live graph with TP/SL/liq lines", () => {
    const page = source();

    expect(page).toContain("function LivePerpGraph");
    expect(page).toContain("<svg");
    expect(page).toContain("buildChannel");
    expect(page).toContain("stakeUsd");
    expect(page).toContain("MAX_GRAPH_POINTS");
    // Each channel line is tagged with its role via data-line, driven by
    // buildChannel's tp/entry/sl/liq ids (asserted against the live render, not
    // a comment — deleting the <g> block must fail this test).
    expect(page).toContain("data-line={line.id}");
    // The four roles are styled/labelled distinctly: tp ceiling, sl floor, liq,
    // entry baseline.
    expect(page).toContain('id === "tp"');
    expect(page).toContain('id === "sl"');
    expect(page).toContain('id === "liq"');
    expect(page).toContain('id === "entry"');
    expect(page).toContain("LIQ");
    // Responsive, not shaky: snappier smoothing constant, soft pulse dot.
    expect(page).toContain("GRAPH_SMOOTHING");
    expect(page).not.toContain("* 0.18");
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

  it("groups desktop Scalp controls into a graph column and order ticket", () => {
    const page = source();
    const route = readFileSync(
      join(process.cwd(), "app/(app)/trade/page.tsx"),
      "utf8",
    );

    expect(page).toContain("lg:grid lg:grid-cols-[minmax(0,1fr)_360px]");
    expect(page).toContain('aria-label="Desktop trade controls"');
    expect(page).toContain('aria-label="Desktop order ticket"');
    expect(page).toContain("lg:max-w-none");
    expect(page).toContain("lg:w-auto");
    expect(page).toContain("mt-auto flex pt-3 lg:mt-3");
    expect(route).toContain('<AppShell railTitle="Trade" hideEmptyRail>');
  });

  it("shows the user stake separately from Flash posted collateral", () => {
    const page = source();

    expect(page).toContain("flashStakeUsdFromPosition");
    expect(page).toContain("stakeForPosition(selectedPosition, selectedPositionView)");
    expect(page).toContain('label="Stake"');
    expect(page).toContain('label={selectedPosition ? "P/L" : "Notional"}');
    expect(page).toContain("fmtUsd(stakeForPosition(position, view))");
    expect(page).toContain("const exitValue = view?.exitValueUsd ?? 0");
    expect(page).toContain("selectedPositionView.exitValueUsd");
    expect(page).toContain("exit {fmtUsd(exitValue)}");
    expect(page).toContain("Exit {fmtUsd(exitValue)}");
    expect(page).not.toContain('label={selectedPosition ? "Collateral" : "Stake"}');
    expect(page).not.toContain("collat {fmtUsd(position.collateralUsd)}");
    expect(page).not.toContain('label={selectedPosition ? "Value" : "Stake"}');
  });

  it("adds a Total window so the user reads current money beside stake and P/L", () => {
    const page = source();

    // Third metric beside Stake and P/L: the live position value (stake +/-
    // P/L), driven by the same graphValue the chart plots, so the user knows
    // how much money is left in the trade.
    expect(page).toContain('label="Total"');
    expect(page).toContain("value={fmtUsd(graphValue)}");
    // Only render the third window for an open position; the order-ticket
    // preview keeps the two-up Stake/Notional layout.
    expect(page).toContain(
      'grid gap-2 ${selectedPosition ? "grid-cols-3" : "grid-cols-2"}',
    );
  });

  it("shows the requested open leverage instead of refreshed effective leverage", () => {
    const page = source();

    expect(page).toContain("flashRequestedLeverageFromPosition");
    expect(page).toContain("function leverageForPosition");
    expect(page).toContain("view?: FlashLivePositionView | null");
    expect(page).toContain("pnlUsd: view.pnlUsd");
    expect(page).toContain("leverageForPosition(position, view).toFixed(0)");
    expect(page).toContain("leverage: result.trade.leverage");
  });

  it("does not cache inferred fallback leverage from refreshed positions", () => {
    const page = source();

    expect(page).not.toContain("seedFlashEntryCostCache");
    expect(page).not.toContain("const seeded = mergeFlashEntryCostCache");
    expect(page).toContain("setPositions(merged)");
  });

  it("wires opt-in TP/SL trigger orders with instant auto-sign", () => {
    const page = source();

    // Off by default: ghost chips until a level is added; liq is never a chip.
    expect(page).toContain("+ Add TP");
    expect(page).toContain("+ Add SL");
    // Active chip with cancel affordance once configured.
    expect(page).toContain("selectedTriggers");
    expect(page).toContain("requestTrigger");
    expect(page).toContain("cancelTrigger");
    // Talks to the new route and reuses the instant + user-signed phases.
    expect(page).toContain('fetch("/api/flash/perp/trigger"');
    expect(page).toContain('result.phase === "sent-trigger"');
    expect(page).toContain('result.phase === "sent-trigger-cancel"');
    expect(page).toContain("signAndSendFlashTransaction");
    // Mobile taps a preset %, desktop can drag — both code paths present.
    expect(page).toContain("TP_PRESETS");
    expect(page).toContain("SL_PRESETS");
    expect(page).toContain("lg:cursor-ns-resize");
  });
});
