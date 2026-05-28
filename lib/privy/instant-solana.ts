import { VersionedTransaction } from "@solana/web3.js";
import { privyServer } from "./server";

export const SOLANA_MAINNET_CAIP2 =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

export interface PrivyInstantSolanaSendRequest {
  walletAddress: string;
  transactionB64: string;
}

export interface PrivyInstantSolanaSendResult {
  signature: string;
  caip2: string;
}

export async function signAndSendPrivySolanaTransaction({
  walletAddress,
  transactionB64,
}: PrivyInstantSolanaSendRequest): Promise<PrivyInstantSolanaSendResult> {
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(transactionB64, "base64"),
  );
  const result = await privyServer.walletApi.solana.signAndSendTransaction({
    address: walletAddress,
    chainType: "solana",
    transaction,
    caip2: SOLANA_MAINNET_CAIP2,
  });
  return {
    signature: result.hash,
    caip2: result.caip2,
  };
}
