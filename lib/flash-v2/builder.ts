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
  // Flash v2 reports errors on three channels: HTTP 200 + body.err (JSON),
  // HTTP 400 plain text, and bare HTTP 500 plain text. Read the body as text
  // first so the text channels reach normalizeFlashError intact — JSON-parsing
  // up front would throw on plain text and discard the real error message.
  const text = await res.text();
  let parsed: unknown = {};
  try {
    if (text) parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const err = normalizeFlashError({
    httpStatus: res.status,
    body: res.status === 200 ? parsed : text,
  });
  if (err) throw err;
  const json = (parsed && typeof parsed === "object" ? parsed : {}) as Record<
    string,
    unknown
  >;
  const b64 =
    (json.transactionBase64 as string | undefined) ??
    (json.transaction as string | undefined);
  if (!b64) throw new FlashV2Error("builder returned no transaction", "unknown");
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  return { tx, raw: json as T };
}
