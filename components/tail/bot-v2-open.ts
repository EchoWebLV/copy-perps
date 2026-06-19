// components/tail/bot-v2-open.ts
//
// Pure helpers for the flag-gated flash-v2 bot-tail open path (Option A client
// repoint). TailModal owns the signing + phase loop + React state; these build
// the request body and adapt the server's open response, kept pure so they're
// unit-testable without Privy/hooks. Mirrors whale-v2-open.ts.
import type { TailSource } from "./tail-types";

type BotSource = Extract<TailSource, { kind: "bot" }>;

/** Request body for POST /api/bet/bot — mirrors the bot's live arena position. */
export function buildBotV2Body(args: {
  bot: BotSource;
  stakeUsdc: number;
  leverage: number;
  walletAddress: string;
  autoCloseOnSourceClose: boolean;
}) {
  return {
    botId: args.bot.botId,
    botName: args.bot.botName,
    market: args.bot.asset,
    side: args.bot.side,
    leverage: args.leverage,
    stakeUsdc: args.stakeUsdc,
    sourcePositionId: args.bot.positionId ?? null,
    autoCloseOnSourceClose: args.autoCloseOnSourceClose,
    walletAddress: args.walletAddress,
  };
}

export interface FlashV2BotOpenSource {
  botName: string;
  asset: string;
  side: "long" | "short";
  leverage: number;
}

/** Adapt the v2 `{ phase:'open', betId, txSig }` bot open (already executed
 *  server-side via the session) onto the OpenResponse shape the success UI
 *  renders. No avg fill price / amount is returned, so show the venue + sig. */
export function flashV2BotOpenToOpenResponse(resp: {
  betId: string;
  txSig: string;
  source: FlashV2BotOpenSource;
}) {
  return {
    phase: "open" as const,
    betId: resp.betId,
    fill: {
      orderId: resp.txSig,
      avgFillPrice: "—",
      filledAmount: "Flash v2 position",
      side: resp.source.side,
    },
    source: resp.source,
  };
}
