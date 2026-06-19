import { describe, expect, it } from "vitest";
import { buildBotV2Body, flashV2BotOpenToOpenResponse } from "./bot-v2-open";
import type { TailSource } from "./tail-types";

const bot: Extract<TailSource, { kind: "bot" }> = {
  kind: "bot",
  botId: "arena:claude",
  botName: "Claude",
  asset: "SOL",
  side: "long",
  leverage: 5,
  entryMark: 140,
  positionId: "arena:claude:1700000000000",
};

describe("buildBotV2Body", () => {
  it("maps a bot source into the /api/bet/bot body", () => {
    const body = buildBotV2Body({
      bot,
      stakeUsdc: 20,
      leverage: 3,
      walletAddress: "WALLET",
      autoCloseOnSourceClose: true,
    });
    expect(body).toEqual({
      botId: "arena:claude",
      botName: "Claude",
      market: "SOL",
      side: "long",
      leverage: 3,
      stakeUsdc: 20,
      sourcePositionId: "arena:claude:1700000000000",
      autoCloseOnSourceClose: true,
      walletAddress: "WALLET",
    });
  });

  it("defaults sourcePositionId to null when the bot has no positionId", () => {
    const body = buildBotV2Body({
      bot: { ...bot, positionId: undefined },
      stakeUsdc: 10,
      leverage: 5,
      walletAddress: "W",
      autoCloseOnSourceClose: false,
    });
    expect(body.sourcePositionId).toBeNull();
  });
});

describe("flashV2BotOpenToOpenResponse", () => {
  it("adapts the server-executed v2 bot open onto the OpenResponse shape", () => {
    const out = flashV2BotOpenToOpenResponse({
      betId: "bet-1",
      txSig: "SIG",
      source: { botName: "Claude", asset: "SOL", side: "long", leverage: 3 },
    });
    expect(out).toMatchObject({
      phase: "open",
      betId: "bet-1",
      fill: { orderId: "SIG", filledAmount: "Flash v2 position", side: "long" },
      source: { asset: "SOL", side: "long", leverage: 3 },
    });
  });
});
