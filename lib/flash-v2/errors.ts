// lib/flash-v2/errors.ts
export type FlashErrorCode =
  | "onboarding_required"
  | "settling"
  | "session_expired"
  | "session_already_bound"
  | "unknown";

export class FlashV2Error extends Error {
  constructor(message: string, readonly code: FlashErrorCode) {
    super(message);
    this.name = "FlashV2Error";
  }
}
export class FlashOnboardingRequiredError extends FlashV2Error {
  constructor(message: string) { super(message, "onboarding_required"); }
}
export class FlashWithdrawSettlingError extends FlashV2Error {
  constructor(message: string) { super(message, "settling"); }
}
export class FlashSessionExpiredError extends FlashV2Error {
  constructor(message: string) { super(message, "session_expired"); }
}

/**
 * Flash v2 reports errors on three channels (GOTCHAS):
 *  - trade/preview: HTTP 200 with `body.err`
 *  - trigger/limit: HTTP 400 plain text
 *  - setup/withdraw: bare HTTP 500
 * Returns null when there is no error. String matching is best-effort and
 * refined against real devnet responses in Task 12.
 */
export function normalizeFlashError(args: {
  httpStatus: number;
  body: unknown;
}): FlashV2Error | null {
  let message: string | null = null;
  if (args.httpStatus === 200) {
    const b = args.body as { err?: unknown } | null;
    if (b && typeof b === "object" && b.err) message = String(b.err);
  } else {
    message =
      typeof args.body === "string" && args.body
        ? args.body
        : `HTTP ${args.httpStatus}`;
  }
  if (message == null) return null;
  return classify(message);
}

function classify(message: string): FlashV2Error {
  const m = message.toLowerCase();
  if (m.includes("0xbc4") || m.includes("accountnotinitialized")) {
    return new FlashWithdrawSettlingError(message);
  }
  if (m.includes("basket") && (m.includes("not init") || m.includes("uninitialized"))) {
    return new FlashOnboardingRequiredError(message);
  }
  if (m.includes("session") && m.includes("expired")) {
    return new FlashSessionExpiredError(message);
  }
  return new FlashV2Error(message, "unknown");
}
