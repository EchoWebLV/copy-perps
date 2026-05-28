import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyPrivyRequest: vi.fn(),
  ensureUser: vi.fn(),
  getFlashPerpsService: vi.fn(),
  signAndSendPrivySolanaTransaction: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  positionsOf: vi.fn(),
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
vi.mock("@/lib/flash/perps", () => ({
  FLASH_MIN_NOTIONAL_USD: 10,
  FlashPerpsError: class FlashPerpsError extends Error {
    code = "QuoteFailed";
  },
  getFlashPerpsService: mocks.getFlashPerpsService,
  isSupportedFlashMarket: (value: unknown) =>
    typeof value === "string" && ["BTC", "ETH", "SOL"].includes(value),
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
    mocks.signAndSendPrivySolanaTransaction.mockResolvedValue({
      signature: "instant-sig",
      caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    });
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

  it("sends a delegated Flash open transaction when instant execution is requested", async () => {
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

  it("sends a delegated Flash close transaction when instant execution is requested", async () => {
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
