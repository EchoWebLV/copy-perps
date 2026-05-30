import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Flash trigger route contract", () => {
  const triggerRoute = () =>
    readFileSync(
      join(process.cwd(), "app/api/flash/perp/trigger/route.ts"),
      "utf8",
    );

  it("requires auth and runs on the node runtime", () => {
    const src = triggerRoute();
    expect(src).toContain("verifyPrivyRequest");
    expect(src).toContain('return NextResponse.json({ error: "unauthorized" }');
    expect(src).toContain('export const runtime = "nodejs"');
  });

  it("POST places (or replaces) a TP/SL and returns a signable tx", () => {
    const src = triggerRoute();
    expect(src).toContain("export async function POST");
    expect(src).toContain("validateTriggerRoi");
    expect(src).toContain("buildPlaceTriggerOrderTx");
    expect(src).toContain("transactionB64");
    // Replace-on-second-of-kind: pass through an existing orderId to edit.
    expect(src).toContain("orderId");
  });

  it("DELETE cancels a trigger by orderId", () => {
    const src = triggerRoute();
    expect(src).toContain("export async function DELETE");
    expect(src).toContain("buildCancelTriggerOrderTx");
  });

  it("auto-signs through the Privy instant path with a sent-trigger phase", () => {
    const src = triggerRoute();
    expect(src).toContain("signAndSendPrivySolanaTransaction");
    expect(src).toContain('phase: "sent-trigger"');
    expect(src).toContain('phase: "sent-trigger-cancel"');
    expect(src).toContain('phase: "sign-trigger"');
    expect(src).toContain('phase: "sign-trigger-cancel"');
  });
});

describe("Flash positions route surfaces triggers", () => {
  const positionsRoute = () =>
    readFileSync(
      join(process.cwd(), "app/api/flash/perp/positions/route.ts"),
      "utf8",
    );

  it("attaches active on-chain triggers with a derived display ROI", () => {
    const src = positionsRoute();
    expect(src).toContain("activeTriggersOf");
    expect(src).toContain("roiPctFromTriggerPrice");
    expect(src).toContain("triggers");
  });
});
