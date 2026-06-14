import { describe, expect, it } from "vitest";
import { decodeLlmBot, LLM_BOT_STRUCT_SIZE } from "./decode";

// Synthesize an LlmBot account buffer at the documented state.rs offsets, then
// decode it. Round-trips the TS decoder against the locked byte layout (the
// Rust llm_bot_layout_locked test guards the Rust side; this guards the offsets
// the decoder reads). Struct base = 8 (Anchor discriminator).
function synthLlmBot(): Uint8Array {
  const buf = Buffer.alloc(8 + LLM_BOT_STRUCT_SIZE);
  const B = 8; // struct base
  buf.writeBigUInt64LE(1_000_000_000n, B + 0x20); // balanceMicro → $1000
  buf.writeBigInt64LE(-50_000_000n, B + 0x28); // grossPnlMicro → -$50
  buf.writeBigUInt64LE(2_400_000n, B + 0x38); // fundingPaidMicro → $2.40
  buf.writeBigInt64LE(5_000n, B + 0x60); // lastDecisionTs (secs)
  buf.writeUInt16LE(3, B + 0x9b8); // tradesToday
  buf.writeUInt8(1, B + 0x9bc); // halted
  buf.write("claude-v1", B + 0x9a0, "utf8"); // persona
  // params @0x988
  buf.writeUInt32LE(2000, B + 0x988 + 0x00); // maxHoldTicks
  buf.writeUInt16LE(15, B + 0x988 + 0x08); // maxLeverage
  buf.writeUInt8(55, B + 0x988 + 0x16); // confidenceFloor
  buf.writeUInt8(1, B + 0x988 + 0x17); // riskSizing
  // position[0] @0x68
  const p0 = B + 0x68;
  buf.writeBigUInt64LE(15_000_000_000n, p0 + 0x00); // entryPrice → $150
  buf.writeBigUInt64LE(100_000_000n, p0 + 0x08); // stakeMicro → $100
  buf.writeBigUInt64LE(14_700_000_000n, p0 + 0x10); // stopPrice → $147
  buf.writeUInt16LE(10, p0 + 0x3c); // leverage
  buf.writeUInt8(1, p0 + 0x3e); // active
  buf.writeUInt8(0, p0 + 0x40); // side long
  return new Uint8Array(buf);
}

describe("decodeLlmBot", () => {
  it("round-trips the documented layout", () => {
    const bot = decodeLlmBot(synthLlmBot());
    expect(bot).not.toBeNull();
    if (!bot) return;
    expect(bot.balanceUsd).toBe(1000);
    expect(bot.grossPnlUsd).toBe(-50);
    expect(bot.fundingPaidUsd).toBeCloseTo(2.4, 6);
    expect(bot.lastDecisionTsMs).toBe(5_000_000);
    expect(bot.tradesToday).toBe(3);
    expect(bot.halted).toBe(true);
    expect(bot.personaName).toBe("claude-v1");
    expect(bot.params.maxLeverage).toBe(15);
    expect(bot.params.confidenceFloor).toBe(55);
    expect(bot.params.riskSizing).toBe(true);
    expect(bot.positions[0]).toMatchObject({
      active: true,
      side: "long",
      entryPrice: 150,
      stakeUsd: 100,
      stopPrice: 147,
      leverage: 10,
    });
    expect(bot.positions.filter((p) => p.active)).toHaveLength(1);
  });

  it("fails closed on a short buffer", () => {
    expect(decodeLlmBot(new Uint8Array(100))).toBeNull();
  });
});
