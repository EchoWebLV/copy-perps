export const PACIFICA_CREDIT_AUTO_WAIT_MS = 90_000;

const MIN_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;

type Sleep = (ms: number) => Promise<void>;

export interface TailRetryDecision {
  retryAfterMs: number;
  message: string;
}

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

async function waitBeforeRetry(params: {
  retryAfterMs: number;
  message: string;
  remainingMs: number;
  elapsedMs: number;
  sleep: Sleep;
  onRetry?: (state: TailCreditRetryState) => void;
}) {
  const waitMs = Math.min(
    Math.max(params.retryAfterMs, MIN_RETRY_DELAY_MS),
    MAX_RETRY_DELAY_MS,
    Math.max(0, params.remainingMs),
  );
  params.onRetry?.({
    elapsedMs: params.elapsedMs,
    remainingMs: params.remainingMs,
    retryAfterMs: waitMs,
    message: params.message,
  });
  await params.sleep(waitMs);
}

export async function retryTailRequestWithCreditWait<T>(params: {
  request: () => Promise<T>;
  sleep: Sleep;
  now?: () => number;
  maxWaitMs?: number;
  onRetry?: (state: TailCreditRetryState) => void;
  retryResult?: (result: T) => TailRetryDecision | null;
}): Promise<T> {
  const now = params.now ?? Date.now;
  const maxWaitMs = params.maxWaitMs ?? PACIFICA_CREDIT_AUTO_WAIT_MS;
  const startedAt = now();

  for (;;) {
    try {
      const result = await params.request();
      const retry = params.retryResult?.(result);
      if (!retry) return result;

      const elapsedMs = Math.max(0, now() - startedAt);
      const remainingMs = Math.max(0, maxWaitMs - elapsedMs);
      if (remainingMs <= 0) {
        throw new PacificaCreditWaitTimeoutError(retry.message);
      }
      await waitBeforeRetry({
        retryAfterMs: retry.retryAfterMs,
        message: retry.message,
        remainingMs,
        elapsedMs,
        sleep: params.sleep,
        onRetry: params.onRetry,
      });
    } catch (err) {
      if (!isRetryableTailError(err)) throw err;

      const elapsedMs = Math.max(0, now() - startedAt);
      const remainingMs = Math.max(0, maxWaitMs - elapsedMs);
      if (remainingMs <= 0) {
        throw new PacificaCreditWaitTimeoutError(err.message);
      }

      const waitMs = retryDelayMs(err, remainingMs);
      await waitBeforeRetry({
        retryAfterMs: waitMs,
        message: err.message,
        remainingMs,
        elapsedMs,
        sleep: params.sleep,
        onRetry: params.onRetry,
      });
    }
  }
}
