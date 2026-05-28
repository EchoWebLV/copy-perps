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
});
