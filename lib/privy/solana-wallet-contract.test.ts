import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Solana wallet selection", () => {
  it("identifies Privy wallets by Privy wallet metadata instead of only display name", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/privy/use-solana-wallet.ts"),
      "utf8",
    );

    expect(source).toContain("isPrivySolanaWallet");
    expect(source).toContain("isPrivyWallet");
    expect(source).toContain('"privy:" in standardWallet.features');
  });
});
