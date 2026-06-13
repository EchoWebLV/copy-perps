import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Deposit wallet recovery UI", () => {
  it("does not leave authenticated users stuck on a generating wallet label", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).toContain("useCreateWallet");
    expect(source).toContain("createAppWallet");
    expect(source).toContain("CREATE APP WALLET");
    expect(source).not.toContain("GENERATING WALLET");
  });

  it("keeps settings free of route-title and wallet-management chrome", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).not.toContain('{`"SETTINGS"`}');
    expect(source).not.toContain("DEPOSIT · WALLET · FEED");
    expect(source).not.toContain('<Stamp label="Wallet" />');
    expect(source).not.toContain("COPY ADDRESS");
  });

  it("does not show stale wallet setup errors once an app wallet exists", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).toContain("!wallet?.address && walletError");
  });

  it("is funding-only — no feed prefs, profile sharing, or jupUSD convert", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    // Mock direction: "Funding only. No settings hiding in here."
    expect(source).not.toContain("feedRailPrefsVisible");
    expect(source).not.toContain("<ProfileShareCard");
    expect(source).not.toContain("CONVERT JUPUSD");
    expect(source).not.toContain("depositDevToolsVisible");
  });

  it("leads with a Ready-to-trade balance and Add funds / Withdraw", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).toContain("Ready to trade");
    expect(source).toContain("ADD FUNDS");
    expect(source).toContain("<WithdrawButton");
    expect(source).toContain("Your USDC address");
  });

  it("does not reserve an empty desktop rail when settings rail features are hidden", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).toContain("hideEmptyRail");
    expect(source).not.toContain("Select a bot or position");
  });
});
