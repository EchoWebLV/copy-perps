// lib/flash-v2/rpc.ts
import { Connection } from "@solana/web3.js";
import { resolveBaseRpc, resolveErRpc, FLASH_V2_CLUSTER } from "./constants";
import type { RpcLayer } from "./types";

export function endpointForLayer(
  layer: RpcLayer,
  opts: { baseRpc: string; erRpc: string },
): string {
  return layer === "er" ? opts.erRpc : opts.baseRpc;
}

const cache: Partial<Record<RpcLayer, Connection>> = {};

/** Trades → ER; setup/withdraw → base. Never mix (GOTCHAS). */
export function getConnection(layer: RpcLayer): Connection {
  if (cache[layer]) return cache[layer]!;
  const endpoint = endpointForLayer(layer, {
    baseRpc: resolveBaseRpc(),
    erRpc: resolveErRpc(FLASH_V2_CLUSTER),
  });
  // "processed": the ER is a single validator with no consensus to wait on.
  const conn = new Connection(endpoint, layer === "er" ? "processed" : "confirmed");
  cache[layer] = conn;
  return conn;
}
