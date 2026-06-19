// lib/flash-v2/builder.ts
import { Buffer } from "node:buffer";
import { VersionedTransaction } from "@solana/web3.js";
import { FLASH_V2_REST_BASE } from "./constants";
import { FlashV2Error, normalizeFlashError } from "./errors";

export interface BuilderResult<T = Record<string, unknown>> {
  tx: VersionedTransaction;
  raw: T;
}

/** POST a transaction-builder endpoint; return the deserialized unsigned tx. */
export async function postBuilder<T = Record<string, unknown>>(
  path: string,
  body: object,
): Promise<BuilderResult<T>> {
  const res = await fetch(`${FLASH_V2_REST_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = normalizeFlashError({ httpStatus: res.status, body: json });
  if (err) throw err;
  const b64 =
    (json.transactionBase64 as string | undefined) ??
    (json.transaction as string | undefined);
  if (!b64) throw new FlashV2Error("builder returned no transaction", "unknown");
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  return { tx, raw: json as T };
}
