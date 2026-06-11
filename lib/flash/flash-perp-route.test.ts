import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getFlashPerpsService: vi.fn(),
  signAndSendPrivySolanaTransaction: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  positionsOf: vi.fn(),
  activeTriggersOf: vi.fn(),
  recordFlashTailOpen: vi.fn(),
  confirmFlashTailOpen: vi.fn(),
}));

vi.mock("@/lib/privy/server", () => ({
  verifyPrivyRequest: mocks.verifyPrivyRequest,
}));
vi.mock("@/lib/privy/instant-solana", () => ({
  signAndSendPrivySolanaTransaction: mocks.signAndSendPrivySolanaTransaction,
}));
vi.mock("@/lib/users/ensure", () => ({
  ensureUser: mocks.ensureUser,
}));
vi.mock("@/lib/bets/flash-tail", () => ({
  recordFlashTailOpen: mocks.recordFlashTailOpen,
  confirmFlashTailOpen: mocks.confirmFlashTailOpen,
}));

vi.mock("@/lib/flash/perps", () => ({
  FLASH_MIN_NOTIONAL_USD: 10,
  FlashPerpsError: class FlashPerpsError extends Error {
    code = "QuoteFailed";
  },
  getFlashPerpsService: mocks.getFlashPerpsService,
  isSupportedFlashMarket: (value: unknown) =>
    typeof value === "string" &&
    ["BTC", "ETH", "SOL", "HYPE", "BONK", "NVDA", "USDJPY"].includes(value),
}));

import { POST as OPEN } from "../../app/api/flash/perp/route";
import { POST as CLOSE } from "../../app/api/flash/perp/close/route";
import { POST as POSITIONS } from "../../app/api/flash/perp/positions/route";

function postRequest(path: string, body: unknown) {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  });
}

describe("Flash perp routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyPrivyRequest.mockResolvedValue({ userId: "privy-user" });
    mocks.ensureUser.mockResolvedValue({
      id: "user-1",
      solanaPubkey: "wallet-1",
    });
    mocks.getFlashPerpsService.mockReturnValue({
      open: mocks.open,
      close: mocks.close,
      positionsOf: mocks.positionsOf,
      activeTriggersOf: mocks.activeTriggersOf,
    });
    mocks.open.mockResolvedValue({
      transaction: "open-tx-b64",
      quote: {
        amountUsd: 1,
        notionalUsd: 20,
        leverage: 20,
        collateralSymbol: "USDC",
      },
      position: {
        symbol: "SOL",
        side: "short",
        positionPubkey: "flash-pos",
        marketAccount: "market",
        entryPriceUsd: 160,
        sizeUsd: 20,
        collateralUsd: 1,
        leverage: 20,
        openTime: 1779930000000,
      },
    });
    mocks.close.mockResolvedValue({
      transaction: "close-tx-b64",
      quote: {
        receiveUsd: 1.24,
        collateralSymbol: "USDC",
        isProfitable: true,
      },
      position: {
        symbol: "SOL",
        side: "short",
        positionPubkey: "flash-pos",
        marketAccount: "market",
        entryPriceUsd: 160,
        sizeUsd: 20,
        collateralUsd: 1,
        openTime: 1779930000000,
      },
    });
    mocks.positionsOf.mockResolvedValue([]);
    mocks.activeTriggersOf.mockResolvedValue(new Map());
    mocks.signAndSendPrivySolanaTransaction.mockResolvedValue({
      signature: "instant-sig",
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    });
    mocks.recordFlashTailOpen.mockResolvedValue("bet-1");
    mocks.confirmFlashTailOpen.mockResolvedValue(true);
  });

  it("builds a user-signed Flash open transaction for $1 20x USDC perps", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "short",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "SOL",
      side: "short",
      amountUsd: 1,
      leverage: 20,
      mode: "standard",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sign",
      venue: "flash",
      transactionB64: "open-tx-b64",
      trade: {
        market: "SOL",
        side: "short",
        stakeUsdc: 1,
        leverage: 20,
        mode: "standard",
      },
    });
  });

  it("builds a Flash Degen open transaction at 500x for Scalp", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 500,
        mode: "degen",
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "SOL",
      side: "long",
      amountUsd: 1,
      leverage: 500,
      mode: "degen",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sign",
      venue: "flash",
      trade: {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 500,
        mode: "degen",
      },
    });
  });

  it("keeps standard Flash opens capped at 100x unless Degen mode is requested", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 500,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "leverage must be between 1x and 100x",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("accepts newly supported Flash whale markets", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "hype",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "HYPE",
      side: "long",
      amountUsd: 1,
      leverage: 20,
      mode: "standard",
    });
  });

  it("uses Degen mode for whale copies above the standard ceiling", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "USDJPY",
        side: "short",
        stakeUsdc: 1,
        leverage: 125,
        mode: "degen",
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "USDJPY",
      side: "short",
      amountUsd: 1,
      leverage: 125,
      mode: "degen",
    });
  });

  it("sends a session-signed Flash open transaction when instant execution is requested", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "short",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
        instant: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.open).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "SOL",
      side: "short",
      amountUsd: 1,
      leverage: 20,
      mode: "standard",
    });
    expect(mocks.signAndSendPrivySolanaTransaction).toHaveBeenCalledWith({
      privyUserId: "privy-user",
      transactionB64: "open-tx-b64",
      walletAddress: "wallet-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sent",
      venue: "flash",
      signature: "instant-sig",
      trade: {
        market: "SOL",
        side: "short",
        stakeUsdc: 1,
        leverage: 20,
        mode: "standard",
      },
    });
  });

  it("rejects Flash trades below the protocol notional floor", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 5,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Flash minimum position is $10 notional",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("rejects custom Flash stakes below one dollar", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 0.5,
        leverage: 100,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "stake must be between $1 and $1000",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("explains wallet USDC shortfall when Flash cannot build the open transaction", async () => {
    mocks.open.mockRejectedValueOnce("Insufficient Funds need more 10000000 tokens");

    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 10,
        leverage: 100,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.open).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "SOL",
      side: "long",
      amountUsd: 10,
      leverage: 100,
      mode: "standard",
    });
    await expect(response.json()).resolves.toMatchObject({
      error: "Need $10.00 more USDC in wallet for this Flash trade.",
    });
  });

  it("builds a user-signed Flash close transaction for a portfolio row", async () => {
    const response = await CLOSE(
      postRequest("/api/flash/perp/close", {
        market: "SOL",
        side: "short",
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.close).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "SOL",
      side: "short",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sign-close",
      venue: "flash",
      transactionB64: "close-tx-b64",
    });
  });

  it("sends a session-signed Flash close transaction when instant execution is requested", async () => {
    const response = await CLOSE(
      postRequest("/api/flash/perp/close", {
        market: "SOL",
        side: "short",
        walletAddress: "wallet-1",
        instant: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.close).toHaveBeenCalledWith({
      trader: "wallet-1",
      market: "SOL",
      side: "short",
    });
    expect(mocks.signAndSendPrivySolanaTransaction).toHaveBeenCalledWith({
      privyUserId: "privy-user",
      transactionB64: "close-tx-b64",
      walletAddress: "wallet-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sent-close",
      venue: "flash",
      signature: "instant-sig",
      trade: {
        market: "SOL",
        side: "short",
      },
    });
  });

  it("records a pending flash-tail bet when tail lineage is present", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
        tail: { sourceKind: "whale", whaleId: "whale-1", sourceName: "Big Whale" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordFlashTailOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        stakeUsdc: 1,
        meta: expect.objectContaining({
          sourceType: "flash-tail",
          whaleId: "whale-1",
          market: "SOL",
          side: "long",
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      phase: "sign",
      betId: "bet-1",
    });
    expect(mocks.confirmFlashTailOpen).not.toHaveBeenCalled();
  });

  it("does not touch the db when tail lineage is absent (Scalp path)", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordFlashTailOpen).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.betId).toBeUndefined();
  });

  it("records and immediately confirms a flash-tail bet on the instant path", async () => {
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
        instant: true,
        tail: { sourceKind: "bot", botId: "pulse", sourceName: "Pulse" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.recordFlashTailOpen).toHaveBeenCalled();
    expect(mocks.confirmFlashTailOpen).toHaveBeenCalledWith({
      betId: "bet-1",
      userId: "user-1",
      signature: "instant-sig",
    });
    await expect(response.json()).resolves.toMatchObject({
      phase: "sent",
      betId: "bet-1",
    });
  });

  it("still returns sent when the inline confirm fails after the instant send", async () => {
    mocks.confirmFlashTailOpen.mockRejectedValueOnce(new Error("db down"));
    const response = await OPEN(
      postRequest("/api/flash/perp", {
        market: "SOL",
        side: "long",
        stakeUsdc: 1,
        leverage: 20,
        walletAddress: "wallet-1",
        instant: true,
        tail: { sourceKind: "bot", botId: "pulse" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      phase: "sent",
      signature: "instant-sig",
      betId: "bet-1",
    });
  });

  it("returns live Flash positions for the authenticated wallet", async () => {
    mocks.positionsOf.mockResolvedValue([
      {
        symbol: "BTC",
        side: "long",
        positionPubkey: "btc-pos",
        marketAccount: "btc-market",
        entryPriceUsd: 100000,
        markPriceUsd: 101000,
        sizeUsd: 100,
        collateralUsd: 1,
        leverage: 100,
        pnlUsd: 0.5,
        receiveUsd: 1.5,
        openTime: 1779930000000,
      },
    ]);

    const response = await POSITIONS(
      postRequest("/api/flash/perp/positions", {
        walletAddress: "wallet-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.positionsOf).toHaveBeenCalledWith("wallet-1");
    await expect(response.json()).resolves.toMatchObject({
      positions: [
        {
          symbol: "BTC",
          side: "long",
          positionPubkey: "btc-pos",
          collateralUsd: 1,
          leverage: 100,
        },
      ],
    });
  });
});
