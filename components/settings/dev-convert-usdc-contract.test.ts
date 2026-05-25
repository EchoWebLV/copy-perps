import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Deposit dev jupUSD conversion", () => {
  it("keeps the convert-to-USDC button dev-only", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/deposit/page.tsx"),
      "utf8",
    );

    expect(source).toContain("showDevTools");
    expect(source).toContain("CONVERT JUPUSD TO USDC");
    expect(source).toContain("/api/dev/convert-jupusd");
    expect(source).toContain("signAndSubmitTx");
  });
});
