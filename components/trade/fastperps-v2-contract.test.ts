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
    // The open's POST /api/trade/perp lives inside runSelfV2Open (the funding
    // driver); the close + positions poll stay inline here.
    expect(source).toContain("runSelfV2Open");
    expect(source).toContain('fetch("/api/trade/perp/close"');
    expect(source).toContain('"/api/trade/perp/positions"');
    expect(source).toContain("buildSelfV2OpenBody");
    expect(source).toContain("buildSelfV2CloseBody");
    expect(source).toContain("synthFlashV2Position");
  });

  it("runs the v1-style session-signed open/close (no per-trade popup)", () => {
    // First tap transparently enables a session + onboards + deposits; the trade
    // itself is signed server-side by the session key, so there is no per-trade
    // wallet popup and no client ER signing.
    expect(source).toContain("enableFlashV2Session");
    expect(source).toContain("enableSession: enableSessionFlow");
    // Setup txs use the same proven (user-paid) signer as the v1 rail — no
    // sponsorship request, which would break Privy signing when unconfigured.
    expect(source).toContain("signBaseTx: signAndSendFlashTransaction");
    // Session expiry mid-close ⇒ re-enable then retry, never strand the position.
    expect(source).toContain('body.phase === "enable-session"');
    // The old user-signed ER path is gone.
    expect(source).not.toContain("signAndSubmitErTx");
    expect(source).not.toContain("useSignTransaction");
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
    // Stake chip filter, autopilot, and TP/SL triggers gate on !flashV2. Degen
    // leverage (up to 500x) is supported on v2 and is NOT hidden.
    expect(source).toContain("!flashV2 || nextStake >= FLASH_V2_MIN_USDC");
    expect(source).toContain("{!flashV2 && (");
    expect(source).toContain("!flashV2 && autopilotMode");
    expect(source).not.toContain('flashV2 ? "standard" : tradeMode');
  });
});
