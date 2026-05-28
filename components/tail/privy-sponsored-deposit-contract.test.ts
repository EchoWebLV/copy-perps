import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TailModal deposit send", () => {
  it("does not request Privy sponsorship by default", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );
    const depositFlow = source.slice(
      source.indexOf("const signAndSendDeposit"),
      source.indexOf("const openOne"),
    );
    const helper = readFileSync(
      join(process.cwd(), "components/tail/deposit-signing.ts"),
      "utf8",
    );

    expect(source).toContain("useSignAndSendTransaction");
    expect(depositFlow).toContain("sendDepositWithSponsorFallback");
    expect(helper).toContain("signAndSendTransaction({");
    expect(helper).toContain("sponsor: true");
    expect(helper).toContain("preferSponsored");
    expect(depositFlow).toContain("preferSponsored: false");
    expect(depositFlow).not.toContain("signTransaction({");
    expect(depositFlow).not.toContain("sendRawTransaction");
  });

  it("keeps retrying when a funded trade returns another deposit phase", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );
    const retryFlow = source.slice(
      source.indexOf("const requestTailWithSettlingRetry"),
      source.indexOf("const signAndSendDeposit"),
    );
    const fundedOpenFlow = source.slice(
      source.indexOf('if (first.phase === "onboard" || first.phase === "deposit")'),
      source.indexOf('if (result.phase !== "open")'),
    );

    expect(retryFlow).toContain("retryResult:");
    expect(fundedOpenFlow).toContain(
      "requestTailWithSettlingRetry(copyPosition, true)",
    );
  });
});
