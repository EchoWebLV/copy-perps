import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Privy embedded Solana wallet creation", () => {
  it("creates an app wallet for every login method", () => {
    const source = readFileSync(
      join(process.cwd(), "components/providers/PrivyClientProvider.tsx"),
      "utf8",
    );

    expect(source).toContain('solana: { createOnLogin: "all-users" }');
    expect(source).not.toContain('createOnLogin: "users-without-wallets"');
  });
});
