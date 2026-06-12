import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Portfolio layout contract", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "app/(app)/portfolio/page.tsx"), "utf8");

  it("starts with the account surface instead of a route title band", () => {
    const page = source();

    expect(page).not.toContain('{`"PORTFOLIO"`}');
    expect(page).not.toContain("YOUR LIVE TRADES");
    expect(page).toContain('aria-label="Refresh portfolio"');
  });

  it("keeps wallet identity and wallet actions on the portfolio screen", () => {
    const page = source();

    expect(page).toContain("copyWalletAddress");
    expect(page).toContain("COPY ADDRESS");
    expect(page).toContain("PacificaWithdrawButton");
    expect(page).toContain("WithdrawButton");
  });

  it("uses subscriptions, open, history, wins, and wallet as the portfolio tabs", () => {
    const page = source();

    expect(page).toContain(
      'type PortfolioTab = "subscriptions" | "open" | "history" | "wins" | "wallet"',
    );
    expect(page).toContain('useState<PortfolioTab>("subscriptions")');
    expect(page).toContain('["subscriptions", "Subs"');
    expect(page).toContain('["open", "Open"');
    expect(page).toContain('["history", "History"');
    expect(page).toContain('["wins", "Wins"');
    expect(page).toContain('["wallet", "Wallet"');
  });

  it("puts subscriptions first and moves wallet to last position in the tab bar", () => {
    const page = source();

    const subsIdx = page.indexOf('["subscriptions"');
    const openIdx = page.indexOf('["open"');
    const historyIdx = page.indexOf('["history"');
    const winsIdx = page.indexOf('["wins"');
    const walletIdx = page.indexOf('["wallet"');

    expect(subsIdx).toBeGreaterThan(-1);
    expect(subsIdx).toBeLessThan(openIdx);
    expect(openIdx).toBeLessThan(historyIdx);
    expect(historyIdx).toBeLessThan(winsIdx);
    expect(winsIdx).toBeLessThan(walletIdx);
  });

  it("keeps wallet actions inside the wallet tab and renders all tab panels", () => {
    const page = source();

    expect(page).toContain('activeTab === "wallet"');
    expect(page).toContain('activeTab === "subscriptions"');
    expect(page).toContain('activeTab === "wins"');
    expect(page).toContain("SubscriptionsPanel");
    expect(page).toContain("WalletTabPanel");
    expect(page).toContain("OpenPositionsPanel");
    expect(page).toContain("ClosedPositionsPanel");
    expect(page).toContain("WinsPanel");
  });

  it("does not render wallet-only balances as total net worth while portfolio data is loading", () => {
    const page = source();

    expect(page).toContain("portfolioBalancesReady");
    expect(page).toContain("walletStableUsd");
    expect(page).toContain("formatMaybeUsd(totalNetWorth, portfolioBalancesReady)");
    expect(page).toContain('label="Wallet cash"');
    expect(page).toContain('label="Trading cash"');
    expect(page).toContain("GAS {walletSol.toFixed(4)} SOL");
  });

  it("clears stale trading account balances when a refresh misses Pacifica", () => {
    const page = source();

    expect(page).toContain("setPacificaAccount(payload.pacificaAccount ?? null)");
    expect(page).toContain("setCachedWalletBalance(payload.walletBalance ?? null)");
    expect(page).not.toContain("payload.pacificaAccount ?? current");
  });

  it("uses compact portfolio sizing instead of oversized summary cards", () => {
    const page = source();

    expect(page).toContain("<BigNum size={30}>");
    expect(page).toContain("CompactPositionSummary");
    expect(page).not.toContain("PositionSummaryPanel");
    expect(page).not.toContain("text-[38px]");
    expect(page).not.toContain("text-[30px]");
  });

  it("uses cached snapshots and slower background refreshes instead of hammering live portfolio", () => {
    const page = source();

    expect(page).toContain('fetch("/api/portfolio/snapshot"');
    expect(page).toContain('fetch("/api/portfolio/refresh"');
    expect(page).toContain("const REFRESH_MS = 30_000");
    expect(page).not.toContain("const POLL_MS = 3000");
  });

  it("hides the generic desktop context rail when portfolio has no rail content", () => {
    const page = source();

    expect(page).toContain(
      '<AppShell rail={portfolioRail} railTitle="My copies" hideEmptyRail>',
    );
    expect(page).not.toContain("Select a bot or position");
  });

  it("renders a visible My copies heading with subtitle above the net-worth hero", () => {
    const page = source();

    // Heading block must be present
    expect(page).toContain(">My copies<");
    expect(page).toContain("Everything you");
    expect(page).toContain("copying, in one place");

    // Heading must appear before the net-worth BigNum so it sits above the hero
    const headingIdx = page.indexOf(">My copies<");
    const netWorthIdx = page.indexOf("formatMaybeUsd(totalNetWorth, portfolioBalancesReady)");
    expect(headingIdx).toBeGreaterThan(-1);
    expect(netWorthIdx).toBeGreaterThan(-1);
    expect(headingIdx).toBeLessThan(netWorthIdx);
  });

  it("renders the Wins tab from the shared LeaderboardFeed component", () => {
    const page = source();

    expect(page).toContain("LeaderboardFeed");
    expect(page).toContain("WinsPanel");
  });

  it("renders the Subscriptions tab from CopyTradingPanel without embedding it in Open", () => {
    const page = source();

    // CopyTradingPanel lives exclusively in SubscriptionsPanel now
    expect(page).toContain("SubscriptionsPanel");
    // CopyTradingPanel must appear in SubscriptionsPanel body, not directly in OpenPositionsPanel
    const subscriptionsBody = page.slice(
      page.indexOf("function SubscriptionsPanel"),
      page.indexOf("function WinsPanel"),
    );
    expect(subscriptionsBody).toContain("CopyTradingPanel");
    const openPanelBody = page.slice(
      page.indexOf("function OpenPositionsPanel"),
      page.indexOf("function ClosedPositionsPanel"),
    );
    expect(openPanelBody).not.toContain("CopyTradingPanel");
  });
});
