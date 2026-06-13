import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Copies (portfolio) layout contract", () => {
  const source = () =>
    readFileSync(join(process.cwd(), "app/(app)/portfolio/page.tsx"), "utf8");

  it("opens with the My copies heading, not a route-title band", () => {
    const page = source();

    expect(page).not.toContain('{`"PORTFOLIO"`}');
    expect(page).not.toContain("YOUR LIVE TRADES");
    expect(page).toContain(">My copies<");
    expect(page).toContain("Everything you");
    expect(page).toContain("copying, in one place");
    expect(page).toContain('aria-label="Refresh copies"');
  });

  it("tabs between the copy sections (Wallet is its own nav tab now)", () => {
    const page = source();

    expect(page).toContain("type CopiesTab");
    expect(page).toContain('useState<CopiesTab>("subscriptions")');
    expect(page).toContain('["subscriptions", "Subs"');
    expect(page).toContain('["open", "Open"');
    expect(page).toContain('["history", "History"');
    expect(page).toContain('["wins", "Wins"');
    // Wallet tab is gone — funding lives on its own nav tab.
    expect(page).not.toContain('["wallet", "Wallet"');

    // Panels are tab-gated, in order.
    expect(page).toContain('activeTab === "subscriptions"');
    expect(page).toContain('activeTab === "wins"');
    const subsIdx = page.indexOf("<SubscriptionsPanel />");
    const openIdx = page.indexOf("<OpenPositionsPanel");
    const histIdx = page.indexOf("<ClosedPositionsPanel");
    const winsIdx = page.indexOf("<WinsPanel />");
    expect(subsIdx).toBeLessThan(openIdx);
    expect(openIdx).toBeLessThan(histIdx);
    expect(histIdx).toBeLessThan(winsIdx);
  });

  it("keeps Wins on the page (founder: stack 3 + keep Wins)", () => {
    const page = source();

    expect(page).toContain("WinsPanel");
    expect(page).toContain("LeaderboardFeed");
  });

  it("moves wallet funding off Copies (Wallet is its own nav tab now)", () => {
    const page = source();

    expect(page).not.toContain("WalletTabPanel");
    expect(page).not.toContain("PacificaWithdrawButton");
    expect(page).not.toContain("COPY ADDRESS");
    expect(page).not.toContain("Wallet cash");
    expect(page).not.toContain("Trading cash");
  });

  it("uses compact position summaries, no oversized net-worth hero", () => {
    const page = source();

    expect(page).toContain("CompactPositionSummary");
    expect(page).not.toContain("PositionSummaryPanel");
    expect(page).not.toContain("<BigNum size={30}>");
    expect(page).not.toContain("text-[38px]");
  });

  it("uses cached snapshots and slower background refreshes", () => {
    const page = source();

    expect(page).toContain('fetch("/api/portfolio/snapshot"');
    expect(page).toContain('fetch("/api/portfolio/refresh"');
    expect(page).toContain("const REFRESH_MS = 30_000");
    expect(page).not.toContain("const POLL_MS = 3000");
  });

  it("clears stale trading account balances when a refresh misses Pacifica", () => {
    const page = source();

    expect(page).toContain("setPacificaAccount(payload.pacificaAccount ?? null)");
    expect(page).toContain("setCachedWalletBalance(payload.walletBalance ?? null)");
    expect(page).not.toContain("payload.pacificaAccount ?? current");
  });

  it("hides the generic desktop context rail (no wallet duplication)", () => {
    const page = source();

    expect(page).toContain('railTitle="My copies"');
    expect(page).toContain("hideEmptyRail");
    expect(page).toContain("const portfolioRail = null");
    expect(page).not.toContain("Select a bot or position");
  });

  it("renders Subscriptions from CopyTradingPanel, not inside Open", () => {
    const page = source();

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
