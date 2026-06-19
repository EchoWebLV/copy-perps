import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("TailModal deposit send", () => {
  it("uses the shared one-dollar Flash stake ladder", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );

    expect(source).toContain("const STAKE_CHIPS = [1, 5, 10, 20] as const");
    expect(source).toContain("const MIN_USDC = 1");
    expect(source).toContain("const [stake, setStake] = useState<number>(1)");
    expect(source).not.toContain("const STAKE_CHIPS = [5, 10, 20, 50] as const");
    // The default reset keeps the $1 ladder for v1/flag-off and bot/self-directed
    // tails; only a flag-on whale tail (which hits the $5-floor v2 rail) raises it.
    expect(source).toContain(
      'setStake(isFlashV2Client() && source?.kind === "whale" ? FLASH_V2_MIN_USDC : 1)',
    );
    expect(source).toContain("const FLASH_V2_MIN_USDC = 5");
  });

  it("prepares tail copies through Flash instead of Pacifica bet routes", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );
    const requestTail = source.slice(
      source.indexOf("const requestTail"),
      source.indexOf("const requestTailWithSettlingRetry"),
    );

    expect(requestTail).toContain('fetch("/api/flash/perp"');
    expect(requestTail).not.toContain('"/api/bet/whale"');
    expect(requestTail).not.toContain('"/api/bet/bot"');
  });

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

  it("does not show a long countdown while waiting for funded credit", () => {
    const source = readFileSync(
      join(process.cwd(), "components/tail/TailModal.tsx"),
      "utf8",
    );
    const retryFlow = source.slice(
      source.indexOf("const requestTailWithSettlingRetry"),
      source.indexOf("const signAndSendDeposit"),
    );

    expect(source).toContain("TAIL_TRADE_SETTLING_AUTO_WAIT_MS = 20_000");
    expect(retryFlow).toContain("maxWaitMs: TAIL_TRADE_SETTLING_AUTO_WAIT_MS");
    expect(retryFlow).not.toContain("Math.ceil(remainingMs / 1000)");
  });
});
