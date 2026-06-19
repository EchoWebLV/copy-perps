import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "components/trade/FastPerpsGame.tsx"),
  "utf8",
);

describe("FastPerpsGame flag-off (v1) path is preserved byte-for-byte", () => {
  it("keeps every v1 Flash endpoint for the flag-off path", () => {
    expect(source).toContain('fetch("/api/flash/perp"');
    expect(source).toContain('"/api/flash/perp/close"');
    expect(source).toContain('"/api/flash/perp/positions"');
    expect(source).toContain('fetch("/api/flash/perp/trigger"');
  });

  it("keeps the v1 sign-and-send (sponsor) path and instant session-signer path", () => {
    expect(source).toContain("sendDepositWithSponsorFallback");
    expect(source).toContain("ensureInstantTrading");
    expect(source).toContain('phase === "sent"');
  });
});

describe("FastPerpsGame flag-on (v2) self-directed repoint", () => {
  it("gates the v2 open/close behind isFlashV2Client()", () => {
    expect(source).toContain("const flashV2 = isFlashV2Client()");
    expect(source).toContain("if (isFlashV2Client()) {");
    expect(source).toContain("await openLiveV2()");
    expect(source).toContain("await closeLiveV2()");
  });

  it("drives the v2 self-directed rails", () => {
    expect(source).toContain('fetch("/api/trade/perp"');
    expect(source).toContain('fetch("/api/trade/perp/close"');
    expect(source).toContain('"/api/trade/perp/positions"');
    expect(source).toContain("buildSelfV2OpenBody");
    expect(source).toContain("buildSelfV2CloseBody");
    expect(source).toContain("synthFlashV2Position");
  });

  it("user-signs the ER tx sign-only then broadcasts via signAndSubmitErTx", () => {
    expect(source).toContain("useSignTransaction");
    expect(source).toContain("signAndSubmitErTx");
    expect(source).toContain("const { signedTransaction } = await signTransaction(");
  });

  it("flag-gates the positions poll URL (v2 vs v1)", () => {
    expect(source).toContain(
      'flashV2 ? "/api/trade/perp/positions" : "/api/flash/perp/positions"',
    );
  });

  it("preserves a recent optimistic synth across the indexer-lagged poll (flag-on)", () => {
    expect(source).toContain("OPTIMISTIC_SYNTH_GRACE_MS");
    expect(source).toContain("const pendingSynths = positionsRef.current.filter(");
    // Pruned against the final list (merged + preserved) so the synth's cached
    // open fee survives, and the v1 path keeps the plain merged replace.
    expect(source).toContain("pruneFlashEntryCostCache(entryCostCacheRef.current, next)");
    expect(source).toContain("setPositions(next)");
  });

  it("clamps stake floor and hides unsupported affordances under the flag", () => {
    expect(source).toContain("useState(flashV2 ? FLASH_V2_MIN_USDC : 1)");
    expect(source).toContain("const FLASH_V2_MIN_USDC = 1");
    // Stake chip filter, degen toggle, autopilot, and TP/SL triggers all gate on !flashV2.
    expect(source).toContain("!flashV2 || nextStake >= FLASH_V2_MIN_USDC");
    expect(source).toContain("{!flashV2 && (");
    expect(source).toContain("!flashV2 && autopilotMode");
    expect(source).toContain('flashV2 ? "standard" : tradeMode');
  });
});
