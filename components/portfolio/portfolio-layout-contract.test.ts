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

  it("uses wallet, open, and closed as the primary portfolio tabs", () => {
    const page = source();

    expect(page).toContain('type PortfolioTab = "wallet" | "open" | "closed"');
    expect(page).toContain('useState<PortfolioTab>("wallet")');
    expect(page).toContain('["wallet", "Wallet"');
    expect(page).toContain('["open", "Open"');
    expect(page).toContain('["closed", "Closed"');
  });

  it("keeps wallet actions inside the wallet tab instead of above every position list", () => {
    const page = source();

    expect(page).toContain('activeTab === "wallet"');
    expect(page).toContain("WalletTabPanel");
    expect(page).toContain("OpenPositionsPanel");
    expect(page).toContain("ClosedPositionsPanel");
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

  it("keeps the last trading account balance when a refresh misses Pacifica", () => {
    const page = source();

    expect(page).toContain("setPacificaAccount((current)");
    expect(page).toContain("payload.pacificaAccount ?? current");
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
});
