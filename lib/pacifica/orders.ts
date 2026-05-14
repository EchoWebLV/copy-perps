import { randomUUID } from "crypto";
import { placeMarketOrder } from "./client";
import { signSolanaMessage } from "./sign";
import type { PacificaOrderFill } from "./types";
import type { AgentWalletRecord } from "@/lib/wallets/agent";

// Side convention: Pacifica uses "bid" for long, "ask" for short.
function toPacificaSide(side: "long" | "short"): "bid" | "ask" {
  return side === "long" ? "bid" : "ask";
}

export async function openCopyOrder(params: {
  agent: AgentWalletRecord;
  symbol: string;
  side: "long" | "short";
  amountBase: string;       // amount in BASE asset units (e.g. SOL units, not USD)
  slippagePercent?: string; // default "1.0"
}): Promise<PacificaOrderFill> {
  const timestamp = Date.now();
  const signed = await signSolanaMessage(
    { type: "create_market_order", timestamp, expiry_window: 5000 },
    {
      symbol: params.symbol,
      amount: params.amountBase,
      side: toPacificaSide(params.side),
      slippage_percent: params.slippagePercent ?? "1.0",
      reduce_only: false,
      client_order_id: randomUUID(),
    },
    params.agent.agentPubkey,
    params.agent.agentSecretKey,
  );
  return placeMarketOrder({
    account: params.agent.mainPubkey,
    agentWallet: params.agent.agentPubkey,
    signatureB58: signed.signatureB58,
    header: signed.header,
    payload: signed.payload,
  });
}

export async function closeCopyOrder(params: {
  agent: AgentWalletRecord;
  symbol: string;
  // Side of the position being closed; we submit the reverse with
  // reduce_only=true.
  positionSide: "long" | "short";
  amountBase: string;
  slippagePercent?: string;
}): Promise<PacificaOrderFill> {
  const timestamp = Date.now();
  const reverseSide: "long" | "short" =
    params.positionSide === "long" ? "short" : "long";
  const signed = await signSolanaMessage(
    { type: "create_market_order", timestamp, expiry_window: 5000 },
    {
      symbol: params.symbol,
      amount: params.amountBase,
      side: toPacificaSide(reverseSide),
      slippage_percent: params.slippagePercent ?? "1.0",
      reduce_only: true,
      client_order_id: randomUUID(),
    },
    params.agent.agentPubkey,
    params.agent.agentSecretKey,
  );
  return placeMarketOrder({
    account: params.agent.mainPubkey,
    agentWallet: params.agent.agentPubkey,
    signatureB58: signed.signatureB58,
    header: signed.header,
    payload: signed.payload,
  });
}
