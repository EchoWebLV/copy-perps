export const PACIFICA_CREDIT_AUTO_WAIT_MS = 90_000;

const MIN_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;

type Sleep = (ms: number) => Promise<void>;

interface RetryableTailError extends Error {
  retryable: boolean;
  retryAfterMs: number;
}

export interface TailCreditRetryState {
  elapsedMs: number;
  remainingMs: number;
  retryAfterMs: number;
  message: string;
}

export class PacificaCreditWaitTimeoutError extends Error {
  constructor(public sourceMessage: string) {
    super(
      "Your funds are confirmed, but your trading balance is still updating. Do not deposit again. Try opening the trade again in about a minute.",
    );
    this.name = "PacificaCreditWaitTimeoutError";
  }
}

function isRetryableTailError(err: unknown): err is RetryableTailError {
  return (
    err instanceof Error &&
    (err as Partial<RetryableTailError>).retryable === true
  );
}

function retryDelayMs(err: RetryableTailError, remainingMs: number): number {
  const requested = Number.isFinite(err.retryAfterMs)
    ? err.retryAfterMs
    : MIN_RETRY_DELAY_MS;
  return Math.min(
    Math.max(requested, MIN_RETRY_DELAY_MS),
    MAX_RETRY_DELAY_MS,
    Math.max(0, remainingMs),
  );
}

export async function retryTailRequestWithCreditWait<T>(params: {
  request: () => Promise<T>;
  sleep: Sleep;
  now?: () => number;
  maxWaitMs?: number;
  onRetry?: (state: TailCreditRetryState) => void;
}): Promise<T> {
  const now = params.now ?? Date.now;
  const maxWaitMs = params.maxWaitMs ?? PACIFICA_CREDIT_AUTO_WAIT_MS;
  const startedAt = now();

  for (;;) {
    try {
      return await params.request();
    } catch (err) {
      if (!isRetryableTailError(err)) throw err;

      const elapsedMs = Math.max(0, now() - startedAt);
      const remainingMs = Math.max(0, maxWaitMs - elapsedMs);
      if (remainingMs <= 0) {
        throw new PacificaCreditWaitTimeoutError(err.message);
      }

      const waitMs = retryDelayMs(err, remainingMs);
      params.onRetry?.({
        elapsedMs,
        remainingMs,
        retryAfterMs: waitMs,
        message: err.message,
      });
      await params.sleep(waitMs);
    }
  }
}
