import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAllMids, reservePaceSlot } from "./client";

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("hyperliquid client resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a 429 rate limit and returns data once it clears", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ETH: "2100" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getAllMids();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ETH: "2100" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx server error and returns data once it recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ETH: "2100" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getAllMids();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ETH: "2100" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient network failure and returns data on recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ ETH: "2100" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getAllMids();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ETH: "2100" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a hung request and retries instead of hanging forever", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ ETH: "2100" }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getAllMids();
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ ETH: "2100" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a 429-bearing error after exhausting retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getAllMids();
    const settled = promise.catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/\b429\b/);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not retry a non-retryable client error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = getAllMids();
    const settled = promise.catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/\b422\b/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("reservePaceSlot", () => {
  it("staggers reservations that arrive together by the gap", () => {
    let r = reservePaceSlot(1000, 0, 400);
    expect(r).toEqual({ slotMs: 1000, nextSlotMs: 1400 });
    // next request arrives at the same instant -> pushed to the next slot
    r = reservePaceSlot(1000, r.nextSlotMs, 400);
    expect(r).toEqual({ slotMs: 1400, nextSlotMs: 1800 });
    // and again -> staggered another gap
    r = reservePaceSlot(1050, r.nextSlotMs, 400);
    expect(r).toEqual({ slotMs: 1800, nextSlotMs: 2200 });
  });

  it("does not delay a request that arrives after the timeline tail", () => {
    const r = reservePaceSlot(9000, 2200, 400);
    expect(r).toEqual({ slotMs: 9000, nextSlotMs: 9400 });
  });
});
