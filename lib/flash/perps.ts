import { AnchorProvider, BN, type BN as AnchorBN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  BN_ZERO,
  BPS_DECIMALS,
  OraclePrice,
  PerpetualsClient,
  PoolConfig,
  PositionAccount,
  Privilege,
  Side,
  USD_DECIMALS,
  type ClosePositionQuoteData,
  type ContractOraclePrice,
  type CustodyConfig,
  type MarketConfig,
  type OpenPositionQuoteData,
} from "flash-sdk";

const FLASH_POOL_NAME = "Crypto.1";
const FLASH_CLUSTER = "mainnet-beta";
const FLASH_COMPUTE_UNITS = 600_000;
const FLASH_SLIPPAGE_BPS = 800;
const USDC_DECIMALS = 6;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_RPC =
  process.env.HELIUS_RPC_URL ??
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
export const FLASH_MIN_NOTIONAL_USD = 10;
export const SUPPORTED_FLASH_MARKETS = ["BTC", "ETH", "SOL"] as const;
export type FlashMarketSymbol = (typeof SUPPORTED_FLASH_MARKETS)[number];
export type FlashSide = "long" | "short";

export type FlashPerpsErrorCode =
  | "UnsupportedMarket"
  | "TradeTooSmall"
  | "InvalidAmount"
  | "InvalidLeverage"
  | "LeverageTooHigh"
  | "PositionNotOpen"
  | "QuoteFailed"
  | "BuildTxFailed";

export class FlashPerpsError extends Error {
  constructor(
    public readonly code: FlashPerpsErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FlashPerpsError";
  }
}

export interface FlashOpenRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
  amountUsd: number;
  leverage: number;
}

export interface FlashCloseRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
}

export interface FlashPositionSummary {
  symbol: FlashMarketSymbol;
  side: FlashSide;
  positionPubkey: string;
  marketAccount: string;
  entryPriceUsd: number;
  markPriceUsd?: number;
  sizeUsd: number;
  collateralUsd: number;
  collateralSymbol: string;
  leverage?: number;
  liquidationPriceUsd?: number;
  pnlUsd?: number;
  receiveUsd?: number;
  isProfitable?: boolean;
  openTime: number;
}

export interface FlashTxQuote {
  amountUsd?: number;
  inputSymbol: "USDC";
  collateralSymbol: string;
  notionalUsd?: number;
  leverage?: number;
  entryPriceUsd?: number;
  liquidationPriceUsd?: number;
  feesUsd?: number;
  receiveUsd?: number;
  isProfitable?: boolean;
}

export interface FlashTxResponse {
  transaction: string;
  quote: FlashTxQuote;
  position: FlashPositionSummary;
}

export function isSupportedFlashMarket(
  value: unknown,
): value is FlashMarketSymbol {
  return (
    typeof value === "string" &&
    (SUPPORTED_FLASH_MARKETS as readonly string[]).includes(value)
  );
}

export function assertFlashTrade(input: {
  amountUsd: number;
  leverage: number;
}): void {
  if (!(Number.isFinite(input.amountUsd) && input.amountUsd > 0)) {
    throw new FlashPerpsError("InvalidAmount");
  }
  if (!(Number.isFinite(input.leverage) && input.leverage > 0)) {
    throw new FlashPerpsError("InvalidLeverage");
  }
  if (input.amountUsd * input.leverage < FLASH_MIN_NOTIONAL_USD) {
    throw new FlashPerpsError("TradeTooSmall");
  }
}

function sideToFlash(side: FlashSide) {
  return side === "long" ? Side.Long : Side.Short;
}

function sideFromMarket(market: MarketConfig): FlashSide {
  return "short" in market.side ? "short" : "long";
}

function marketMatchesSide(market: MarketConfig, side: FlashSide): boolean {
  return side === "long" ? "long" in market.side : "short" in market.side;
}

export function leverageToFlashBps(leverage: number): AnchorBN {
  return new BN(Math.round(leverage * 10 ** BPS_DECIMALS));
}

function usdToUsdcAtomic(amountUsd: number): AnchorBN {
  return new BN(Math.ceil(amountUsd * 10 ** USDC_DECIMALS));
}

function bnToNumber(value: AnchorBN, decimals: number): number {
  return Number(value.toString()) / 10 ** decimals;
}

function contractPriceToNumber(value: ContractOraclePrice): number {
  return Number(value.price.toString()) * 10 ** value.exponent;
}

function contractPriceToOracle(value: ContractOraclePrice): OraclePrice {
  return new OraclePrice({
    price: value.price,
    exponent: new BN(value.exponent),
    confidence: BN_ZERO,
    timestamp: BN_ZERO,
  });
}

function hasOpenSize(position: { sizeAmount: AnchorBN; isActive: boolean }) {
  return position.isActive && !position.sizeAmount.isZero();
}

function applyCloseQuoteToSummary(
  summary: FlashPositionSummary,
  quote: Pick<
    ClosePositionQuoteData,
    | "markPrice"
    | "existingLiquidationPrice"
    | "existingLeverage"
    | "receiveTokenAmountUsd"
    | "profitUsd"
    | "lossUsd"
    | "isProfitable"
  >,
): FlashPositionSummary {
  const profitUsd = bnToNumber(quote.profitUsd, USD_DECIMALS);
  const lossUsd = bnToNumber(quote.lossUsd, USD_DECIMALS);
  return {
    ...summary,
    markPriceUsd: contractPriceToNumber(quote.markPrice),
    liquidationPriceUsd: contractPriceToNumber(quote.existingLiquidationPrice),
    leverage: bnToNumber(quote.existingLeverage, BPS_DECIMALS),
    receiveUsd: bnToNumber(quote.receiveTokenAmountUsd, USD_DECIMALS),
    pnlUsd: quote.isProfitable ? profitUsd : -lossUsd,
    isProfitable: quote.isProfitable,
  };
}

export class FlashPerpsService {
  private readonly connection: Connection;
  private readonly poolConfig: PoolConfig;

  constructor(rpcUrl = DEFAULT_RPC) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.poolConfig = PoolConfig.fromIdsByName(FLASH_POOL_NAME, FLASH_CLUSTER);
  }

  async positionsOf(trader: string): Promise<FlashPositionSummary[]> {
    const owner = new PublicKey(trader);
    const client = this.createClient(owner);
    const positions = await client.getUserPositions(owner, this.poolConfig);
    const result: FlashPositionSummary[] = [];
    for (const position of positions) {
      if (!hasOpenSize(position)) continue;
      const market = this.poolConfig.markets.find((m) =>
        m.marketAccount.equals(position.market),
      );
      if (!market) continue;
      const symbol = this.symbolForMarket(market);
      if (!symbol) continue;
      const summary = this.positionSummary(position.pubkey, position, market, symbol);
      try {
        const quote = await client.getClosePositionQuote(
          position.pubkey,
          PositionAccount.from(position.pubkey, position),
          this.poolConfig,
          new BN(0),
          Privilege.None,
          this.usdcCustody(),
          null,
          null,
          owner,
        );
        result.push(applyCloseQuoteToSummary(summary, quote));
      } catch {
        result.push(summary);
      }
    }
    return result;
  }

  async open(req: FlashOpenRequest): Promise<FlashTxResponse> {
    assertFlashTrade(req);
    const owner = new PublicKey(req.trader);
    const client = this.createClient(owner);
    const market = this.marketForSymbol(req.market, req.side);
    const maxLeverage = Math.floor(Number(market.maxLev));
    if (maxLeverage > 0 && req.leverage > maxLeverage) {
      throw new FlashPerpsError("LeverageTooHigh");
    }

    const amountIn = usdToUsdcAtomic(req.amountUsd);
    const flashSide = sideToFlash(req.side);
    let quote: OpenPositionQuoteData;
    try {
      quote = await client.getOpenPositionQuote(
        amountIn,
        leverageToFlashBps(req.leverage),
        market,
        this.poolConfig,
        Privilege.None,
        this.usdcCustody(),
        undefined,
        null,
        null,
        owner,
      );
    } catch (err) {
      throw new FlashPerpsError("QuoteFailed", String(err));
    }

    const priceWithSlippage = client.getPriceAfterSlippage(
      true,
      new BN(FLASH_SLIPPAGE_BPS),
      contractPriceToOracle(quote.entryPrice),
      flashSide,
    );
    const collateralSymbol = this.collateralSymbolForMarket(market);
    const txData =
      collateralSymbol === "USDC"
        ? await client.openPosition(
            req.market,
            collateralSymbol,
            priceWithSlippage,
            quote.amountIn,
            quote.sizeAmount,
            flashSide,
            this.poolConfig,
            Privilege.None,
          )
        : await client.swapAndOpen(
            req.market,
            collateralSymbol,
            "USDC",
            quote.amountIn,
            priceWithSlippage,
            quote.sizeAmount,
            flashSide,
            this.poolConfig,
            Privilege.None,
          );

    const transaction = await this.serializeInstructions(
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    const summary = this.positionSummary(
      this.poolConfig.getPositionFromMarketPk(owner, market.marketAccount),
      {
        market: market.marketAccount,
        entryPrice: quote.entryPrice,
        sizeUsd: quote.sizeUsd,
        collateralUsd: quote.collateralUsd,
        openTime: new BN(Math.floor(Date.now() / 1000)),
      },
      market,
      req.market,
    );
    return {
      transaction,
      quote: {
        amountUsd: req.amountUsd,
        inputSymbol: "USDC",
        collateralSymbol,
        notionalUsd: bnToNumber(quote.sizeUsd, USD_DECIMALS),
        leverage: bnToNumber(quote.leverage, BPS_DECIMALS),
        entryPriceUsd: contractPriceToNumber(quote.entryPrice),
        liquidationPriceUsd: contractPriceToNumber(quote.liquidationPrice),
        feesUsd: bnToNumber(quote.totalFeeUsd, USD_DECIMALS),
      },
      position: {
        ...summary,
        markPriceUsd: contractPriceToNumber(quote.entryPrice),
        liquidationPriceUsd: contractPriceToNumber(quote.liquidationPrice),
        leverage: bnToNumber(quote.leverage, BPS_DECIMALS),
      },
    };
  }

  async close(req: FlashCloseRequest): Promise<FlashTxResponse> {
    const owner = new PublicKey(req.trader);
    const client = this.createClient(owner);
    const market = this.marketForSymbol(req.market, req.side);
    const positionPk = this.poolConfig.getPositionFromMarketPk(
      owner,
      market.marketAccount,
    );
    const position = (await client.getUserPositions(owner, this.poolConfig)).find(
      (p) => p.pubkey.equals(positionPk) && hasOpenSize(p),
    );
    if (!position) throw new FlashPerpsError("PositionNotOpen");

    const positionAccount = PositionAccount.from(positionPk, position);
    let quote: ClosePositionQuoteData;
    try {
      quote = await client.getClosePositionQuote(
        positionPk,
        positionAccount,
        this.poolConfig,
        new BN(0),
        Privilege.None,
        this.usdcCustody(),
        null,
        null,
        owner,
      );
    } catch (err) {
      throw new FlashPerpsError("QuoteFailed", String(err));
    }

    const flashSide = sideToFlash(req.side);
    const priceWithSlippage = client.getPriceAfterSlippage(
      false,
      new BN(FLASH_SLIPPAGE_BPS),
      contractPriceToOracle(quote.markPrice),
      flashSide,
    );
    const collateralSymbol = this.collateralSymbolForMarket(market);
    const txData =
      collateralSymbol === "USDC"
        ? await client.closePosition(
            req.market,
            collateralSymbol,
            priceWithSlippage,
            flashSide,
            this.poolConfig,
            Privilege.None,
            undefined,
            undefined,
            true,
          )
        : await client.closeAndSwap(
            req.market,
            "USDC",
            collateralSymbol,
            priceWithSlippage,
            flashSide,
            this.poolConfig,
            Privilege.None,
          );

    const transaction = await this.serializeInstructions(
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    return {
      transaction,
      quote: {
        inputSymbol: "USDC",
        collateralSymbol,
        receiveUsd: bnToNumber(quote.receiveTokenAmountUsd, USD_DECIMALS),
        feesUsd: bnToNumber(quote.fees, USD_DECIMALS),
        isProfitable: quote.isProfitable,
      },
      position: applyCloseQuoteToSummary(
        this.positionSummary(positionPk, position, market, req.market),
        quote,
      ),
    };
  }

  private createClient(owner: PublicKey): PerpetualsClient {
    const wallet = {
      publicKey: owner,
      signTransaction: async <T>(tx: T): Promise<T> => tx,
      signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
    } as AnchorProvider["wallet"];
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "processed",
    });
    return new PerpetualsClient(
      provider,
      this.poolConfig.programId,
      this.poolConfig.perpComposibilityProgramId,
      this.poolConfig.fbNftRewardProgramId,
      this.poolConfig.rewardDistributionProgram.programId,
      {},
    );
  }

  private marketForSymbol(
    symbol: FlashMarketSymbol,
    side: FlashSide,
  ): MarketConfig {
    const token = this.poolConfig.tokens.find((t) => t.symbol === symbol);
    const usdcMint = new PublicKey(USDC_MINT);
    const market = token
      ? this.poolConfig.markets.find((m) => {
          if (!m.targetMint.equals(token.mintKey)) return false;
          if (!marketMatchesSide(m, side)) return false;
          return side === "long"
            ? m.collateralMint.equals(token.mintKey)
            : m.collateralMint.equals(usdcMint);
        })
      : undefined;
    if (!market) throw new FlashPerpsError("UnsupportedMarket");
    return market;
  }

  private symbolForMarket(market: MarketConfig): FlashMarketSymbol | null {
    const token = this.poolConfig.tokens.find((t) =>
      t.mintKey.equals(market.targetMint),
    );
    return isSupportedFlashMarket(token?.symbol) ? token.symbol : null;
  }

  private collateralSymbolForMarket(market: MarketConfig): string {
    return (
      this.poolConfig.tokens.find((t) => t.mintKey.equals(market.collateralMint))
        ?.symbol ?? "USDC"
    );
  }

  private usdcCustody(): CustodyConfig {
    const custody = this.poolConfig.custodies.find((c) => c.symbol === "USDC");
    if (!custody) throw new FlashPerpsError("UnsupportedMarket");
    return custody;
  }

  private positionSummary(
    positionPk: PublicKey,
    position: {
      market: PublicKey;
      entryPrice: ContractOraclePrice;
      sizeUsd: AnchorBN;
      collateralUsd: AnchorBN;
      openTime: AnchorBN;
    },
    market: MarketConfig,
    symbol: FlashMarketSymbol,
  ): FlashPositionSummary {
    return {
      symbol,
      side: sideFromMarket(market),
      positionPubkey: positionPk.toBase58(),
      marketAccount: market.marketAccount.toBase58(),
      entryPriceUsd: contractPriceToNumber(position.entryPrice),
      sizeUsd: bnToNumber(position.sizeUsd, USD_DECIMALS),
      collateralUsd: bnToNumber(position.collateralUsd, USD_DECIMALS),
      collateralSymbol: this.collateralSymbolForMarket(market),
      openTime: position.openTime.toNumber() * 1000,
    };
  }

  private async serializeInstructions(
    owner: PublicKey,
    instructions: TransactionInstruction[],
    additionalSigners: Signer[],
    client: PerpetualsClient,
  ): Promise<string> {
    try {
      const blockhash = await this.connection.getLatestBlockhash("finalized");
      const { addressLookupTables } = await client.getOrLoadAddressLookupTable(
        this.poolConfig,
      );
      const message = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({
            units: FLASH_COMPUTE_UNITS,
          }),
          ...instructions,
        ],
      }).compileToV0Message(addressLookupTables);
      const tx = new VersionedTransaction(message);
      if (additionalSigners.length > 0) tx.sign(additionalSigners);
      return Buffer.from(tx.serialize()).toString("base64");
    } catch (err) {
      throw new FlashPerpsError("BuildTxFailed", String(err));
    }
  }
}

let singleton: FlashPerpsService | null = null;

export function getFlashPerpsService(): FlashPerpsService {
  singleton ??= new FlashPerpsService();
  return singleton;
}
