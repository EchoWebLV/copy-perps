import { describe, expect, it, vi } from "vitest";
import {
  PacificaCreditWaitTimeoutError,
  retryTailRequestWithCreditWait,
} from "./tail-settling-retry";

describe("retryTailRequestWithCreditWait", () => {
  it("stops waiting quickly when Pacifica crediting keeps returning retryable errors", async () => {
    let nowMs = 0;
    const request = vi.fn().mockRejectedValue(
      Object.assign(new Error("Pacifica is still crediting it."), {
        retryable: true,
        retryAfterMs: 5000,
      }),
    );
    const sleep = vi.fn(async (ms: number) => {
      nowMs += ms;
    });
    const onRetry = vi.fn();

    await expect(
      retryTailRequestWithCreditWait({
        request,
        sleep,
        now: () => nowMs,
        maxWaitMs: 12_000,
        onRetry,
      }),
    ).rejects.toMatchObject({
      name: "PacificaCreditWaitTimeoutError",
      message: expect.stringContaining("Try opening the trade again"),
    });

    expect(request).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 5000);
    expect(sleep).toHaveBeenNthCalledWith(2, 5000);
    expect(sleep).toHaveBeenNthCalledWith(3, 2000);
    expect(onRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        elapsedMs: 10_000,
        remainingMs: 2000,
      }),
    );
  });

  it("does not retry non-retryable tail errors", async () => {
    const err = Object.assign(new Error("bad request"), {
      retryable: false,
      retryAfterMs: 2000,
    });
    const sleep = vi.fn();

    await expect(
      retryTailRequestWithCreditWait({
        request: vi.fn().mockRejectedValue(err),
        sleep,
        now: () => 0,
      }),
    ).rejects.toBe(err);

    expect(sleep).not.toHaveBeenCalled();
  });
});
