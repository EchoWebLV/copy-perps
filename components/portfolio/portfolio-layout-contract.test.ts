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
});
