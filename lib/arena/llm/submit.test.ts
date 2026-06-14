import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  buildApplyDecisionIx,
  encodeApplyDecisionData,
  ixDiscriminator,
  llmBotPda,
  personaIdBytes,
} from "./submit";
import type { ApplyDecisionArgs } from "./floor";
import { DECISION_ACTION, DECISION_SIDE } from "./schema";

const PROGRAM = new PublicKey("6YSSWe8Sj5Xcoc3gRKtWLnMAwxF7aeKHmxi4Kha5YywC");
const FEED = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
const OPERATOR = new PublicKey("11111111111111111111111111111111");

const openArgs: ApplyDecisionArgs = {
  action: DECISION_ACTION.open, // 1
  side: DECISION_SIDE.long, // 0
  leverage: 10,
  stakeFracBps: 1_000,
  stopBps: 200,
  tpBps: 400,
  confidence: 80,
};

describe("submit encoding", () => {
  it("discriminator is 8 bytes and deterministic", () => {
    const d = ixDiscriminator("apply_decision");
    expect(d.length).toBe(8);
    expect(d.equals(ixDiscriminator("apply_decision"))).toBe(true);
    expect(d.equals(ixDiscriminator("tick"))).toBe(false);
  });

  it("personaIdBytes is 16 bytes, utf8 zero-padded", () => {
    const b = personaIdBytes("claude-v1");
    expect(b.length).toBe(16);
    expect(b.subarray(0, 9).toString("utf8")).toBe("claude-v1");
    expect(b[9]).toBe(0);
  });

  it("encodes data = 8 disc + 12 arg bytes with correct fields", () => {
    const data = encodeApplyDecisionData(0, openArgs);
    expect(data.length).toBe(20);
    const body = data.subarray(8);
    expect(body.readUInt8(0)).toBe(0); // market_id
    expect(body.readUInt8(1)).toBe(1); // action open
    expect(body.readUInt8(2)).toBe(0); // side long
    expect(body.readUInt16LE(3)).toBe(10); // leverage
    expect(body.readUInt16LE(5)).toBe(1_000); // stakeFracBps
    expect(body.readUInt16LE(7)).toBe(200); // stopBps
    expect(body.readUInt16LE(9)).toBe(400); // tpBps
    expect(body.readUInt8(11)).toBe(80); // confidence
  });

  it("builds an ix with the right accounts, signer, and writability", () => {
    const ix = buildApplyDecisionIx({
      programId: PROGRAM,
      persona: "claude-v1",
      operator: OPERATOR,
      feed: FEED,
      marketId: 0,
      args: openArgs,
    });
    expect(ix.programId.equals(PROGRAM)).toBe(true);
    expect(ix.keys).toHaveLength(4);
    // operator is the only signer
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([
      OPERATOR.toBase58(),
    ]);
    // llm_bot (index 2) is the only writable
    expect(ix.keys[2].pubkey.equals(llmBotPda(PROGRAM, "claude-v1"))).toBe(true);
    expect(ix.keys[2].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(FEED)).toBe(true);
    expect(ix.data.length).toBe(20);
  });
});
