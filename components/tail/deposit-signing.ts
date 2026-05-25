import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";

type SignAndSendTransaction = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  options?: { sponsor?: boolean };
}) => Promise<{ signature: Uint8Array | string }>;

interface SendDepositArgs {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  signAndSendTransaction: SignAndSendTransaction;
  onSponsorFallback?: (err: unknown) => void;
}

function collectErrorText(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const parts: string[] = [];
  if (value instanceof Error) {
    parts.push(value.name, value.message);
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "message",
    "cause",
    "error",
    "details",
    "detail",
    "privyErrorCode",
  ]) {
    parts.push(collectErrorText(record[key], seen));
  }
  return parts.filter(Boolean).join(" ");
}

export function isSponsoredSendUnsupported(err: unknown): boolean {
  const text = collectErrorText(err).toLowerCase();
  return (
    text.includes("sponsor") ||
    text.includes("sponsoring") ||
    text.includes("gasless") ||
    text.includes("tee stack") ||
    text.includes("invalid_data") ||
    text.includes("failed to connect to wallet") ||
    text.includes("something went wrong")
  );
}

export function formatTailSigningError(err: unknown): string {
  const text = collectErrorText(err);
  if (/failed to connect to wallet/i.test(text)) {
    return "Wallet signing failed in Privy before the deposit could be sent. Reopen Settings, make sure the app wallet is ready, then try copying again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export async function sendDepositWithSponsorFallback({
  transaction,
  wallet,
  signAndSendTransaction,
  onSponsorFallback,
}: SendDepositArgs): Promise<{
  signature: Uint8Array | string;
  sponsored: boolean;
}> {
  try {
    const result = await signAndSendTransaction({
      transaction,
      wallet,
      options: { sponsor: true },
    });
    return { signature: result.signature, sponsored: true };
  } catch (err) {
    if (!isSponsoredSendUnsupported(err)) {
      throw err;
    }
    onSponsorFallback?.(err);
  }

  const result = await signAndSendTransaction({
    transaction,
    wallet,
  });
  return { signature: result.signature, sponsored: false };
}
