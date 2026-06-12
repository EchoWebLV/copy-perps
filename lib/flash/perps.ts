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
  type TriggerOrder,
} from "flash-sdk";
import {
  FLASH_POOL_NAMES,
  flashLeverageBoundsForMarket,
  flashPoolNameForMarket,
  normalizeFlashMarket,
  type FlashMarketSymbol,
  type FlashPoolName,
  type FlashTradeMode,
} from "./markets";
import {
  roiPctToIntegerPercent,
  type TriggerKind,
  type TriggerOrderView,
} from "./triggers";

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
export type FlashSide = "long" | "short";

export type FlashPerpsErrorCode =
  | "UnsupportedMarket"
  | "TradeTooSmall"
  | "InvalidAmount"
  | "InvalidLeverage"
  | "LeverageTooHigh"
  | "PositionNotOpen"
  | "QuoteFailed"
  | "BuildTxFailed"
  | "InvalidTrigger";

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
  mode?: FlashTradeMode;
}

export interface FlashCloseRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
}

export interface FlashTriggerRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
  kind: TriggerKind;
  /** Validated ROI percent (already clamped by validateTriggerRoi). */
  roiPct: number;
  /** When replacing an existing same-kind order, its 1-based slot ordinal. */
  orderId?: number;
}

export interface FlashTriggerCancelRequest {
  trader: string;
  market: FlashMarketSymbol;
  side: FlashSide;
  kind: TriggerKind;
  orderId: number;
}

export interface FlashTriggerTxResponse {
  transaction: string;
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
  entryCostUsd?: number;
  openFeeUsd?: number;
  isProfitable?: boolean;
  openTime: number;
  triggers?: TriggerOrderView[];
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
  return normalizeFlashMarket(value) !== null;
}

/** getClosePositionQuote returns `fees` at 8 decimals (verified on-chain
 *  2026-06-12: a $2.26 close fee came back as 226_019_104), unlike the
 *  quote's other USD fields and unlike position.collateralUsd (6 decimals).
 *  Rescale before mixing it into 6dp USD math — fed raw into
 *  getTriggerPriceFromRoiSync it inflates the exit fee 100×, swamps the ROI
 *  term, and every TP/SL computes to ≈ entry price (on-chain rejects 6049
 *  InvalidStopLossPrice / 6034 MinCollateral). */
export const CLOSE_QUOTE_FEE_DECIMALS = 8;

export function closeQuoteFeeToUsd6(fees: AnchorBN): AnchorBN {
  return fees.div(new BN(10 ** (CLOSE_QUOTE_FEE_DECIMALS - USD_DECIMALS)));
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

function leverageFromPositionCollateral(
  sizeUsd: number,
  collateralUsd: number,
): number | undefined {
  if (
    !Number.isFinite(sizeUsd) ||
    !Number.isFinite(collateralUsd) ||
    sizeUsd <= 0 ||
    collateralUsd <= 0
  ) {
    return undefined;
  }
  return sizeUsd / collateralUsd;
}

function applyCloseQuoteToSummary(
  summary: FlashPositionSummary,
  quote: Pick<
    ClosePositionQuoteData,
    | "markPrice"
    | "existingLiquidationPrice"
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
    receiveUsd: bnToNumber(quote.receiveTokenAmountUsd, USD_DECIMALS),
    pnlUsd: quote.isProfitable ? profitUsd : -lossUsd,
    isProfitable: quote.isProfitable,
  };
}

export class FlashPerpsService {
  private readonly connection: Connection;
  private readonly poolConfigs: PoolConfig[];
  private readonly poolConfigByName: Map<FlashPoolName, PoolConfig>;

  constructor(rpcUrl = DEFAULT_RPC) {
    this.connection = new Connection(rpcUrl, "confirmed");
    const poolEntries = FLASH_POOL_NAMES.map((poolName) => [
      poolName,
      PoolConfig.fromIdsByName(poolName, FLASH_CLUSTER),
    ] as const);
    this.poolConfigs = poolEntries.map(([, poolConfig]) => poolConfig);
    this.poolConfigByName = new Map<FlashPoolName, PoolConfig>(poolEntries);
  }

  async positionsOf(trader: string): Promise<FlashPositionSummary[]> {
    const owner = new PublicKey(trader);
    const result: FlashPositionSummary[] = [];
    for (const poolConfig of this.poolConfigs) {
      const client = this.createClient(owner, poolConfig);
      const positions = await client.getUserPositions(owner, poolConfig);
      for (const position of positions) {
        if (!hasOpenSize(position)) continue;
        const market = poolConfig.markets.find((m) =>
          m.marketAccount.equals(position.market),
        );
        if (!market) continue;
        const symbol = this.symbolForMarket(poolConfig, market);
        if (!symbol) continue;
        const summary = this.positionSummary(
          poolConfig,
          position.pubkey,
          position,
          market,
          symbol,
        );
        try {
          const quote = await client.getClosePositionQuote(
            position.pubkey,
            PositionAccount.from(position.pubkey, position),
            poolConfig,
            new BN(0),
            Privilege.None,
            this.usdcCustody(poolConfig),
            null,
            null,
            owner,
          );
          result.push(applyCloseQuoteToSummary(summary, quote));
        } catch {
          result.push(summary);
        }
      }
    }
    return result;
  }

  async open(req: FlashOpenRequest): Promise<FlashTxResponse> {
    assertFlashTrade(req);
    const owner = new PublicKey(req.trader);
    const poolConfig = this.poolConfigForMarket(req.market);
    const client = this.createClient(owner, poolConfig);
    const market = this.marketForSymbol(poolConfig, req.market, req.side);
    const mode = req.mode ?? "standard";
    const configuredBounds = flashLeverageBoundsForMarket(req.market, mode);
    if (!configuredBounds) {
      throw new FlashPerpsError("InvalidLeverage");
    }
    const minLeverage = configuredBounds.min;
    const maxLeverage = Math.min(
      configuredBounds.max,
      Math.floor(
        Number(mode === "degen" ? market.degenMaxLev : market.maxLev),
      ),
    );
    if (minLeverage > 0 && req.leverage < minLeverage) {
      throw new FlashPerpsError(
        "InvalidLeverage",
        `leverage must be at least ${minLeverage}x`,
      );
    }
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
        poolConfig,
        Privilege.None,
        this.usdcCustody(poolConfig),
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
    const collateralSymbol = this.collateralSymbolForMarket(poolConfig, market);
    const txData =
      collateralSymbol === "USDC"
        ? await client.openPosition(
            req.market,
            collateralSymbol,
            priceWithSlippage,
            quote.amountIn,
            quote.sizeAmount,
            flashSide,
            poolConfig,
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
            poolConfig,
            Privilege.None,
          );

    const transaction = await this.serializeInstructions(
      poolConfig,
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    const summary = this.positionSummary(
      poolConfig,
      poolConfig.getPositionFromMarketPk(owner, market.marketAccount),
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
        entryCostUsd: req.amountUsd,
        openFeeUsd: bnToNumber(quote.totalFeeUsd, USD_DECIMALS),
      },
    };
  }

  async close(req: FlashCloseRequest): Promise<FlashTxResponse> {
    const owner = new PublicKey(req.trader);
    const poolConfig = this.poolConfigForMarket(req.market);
    const client = this.createClient(owner, poolConfig);
    const market = this.marketForSymbol(poolConfig, req.market, req.side);
    const positionPk = poolConfig.getPositionFromMarketPk(
      owner,
      market.marketAccount,
    );
    const position = (await client.getUserPositions(owner, poolConfig)).find(
      (p) => p.pubkey.equals(positionPk) && hasOpenSize(p),
    );
    if (!position) throw new FlashPerpsError("PositionNotOpen");

    const positionAccount = PositionAccount.from(positionPk, position);
    let quote: ClosePositionQuoteData;
    try {
      quote = await client.getClosePositionQuote(
        positionPk,
        positionAccount,
        poolConfig,
        new BN(0),
        Privilege.None,
        this.usdcCustody(poolConfig),
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
    const collateralSymbol = this.collateralSymbolForMarket(poolConfig, market);
    const txData =
      collateralSymbol === "USDC"
        ? await client.closePosition(
            req.market,
            collateralSymbol,
            priceWithSlippage,
            flashSide,
            poolConfig,
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
            poolConfig,
            Privilege.None,
          );

    const transaction = await this.serializeInstructions(
      poolConfig,
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
        feesUsd: bnToNumber(quote.fees, CLOSE_QUOTE_FEE_DECIMALS),
        isProfitable: quote.isProfitable,
      },
      position: applyCloseQuoteToSummary(
        this.positionSummary(poolConfig, positionPk, position, market, req.market),
        quote,
      ),
    };
  }

  async buildPlaceTriggerOrderTx(
    req: FlashTriggerRequest,
  ): Promise<FlashTriggerTxResponse> {
    const owner = new PublicKey(req.trader);
    const poolConfig = this.poolConfigForMarket(req.market);
    const client = this.createClient(owner, poolConfig);
    const market = this.marketForSymbol(poolConfig, req.market, req.side);
    const positionPk = poolConfig.getPositionFromMarketPk(
      owner,
      market.marketAccount,
    );
    const raw = (await client.getUserPositions(owner, poolConfig)).find(
      (p) => p.pubkey.equals(positionPk) && hasOpenSize(p),
    );
    if (!raw) throw new FlashPerpsError("PositionNotOpen");
    const position = PositionAccount.from(positionPk, raw);

    // Exit fee from a live close quote — feeds getTriggerPriceFromRoiSync.
    let exitFeeUsd: AnchorBN;
    let markPriceUsd: number;
    let liqPriceUsd: number;
    try {
      const quote = await client.getClosePositionQuote(
        positionPk,
        position,
        poolConfig,
        new BN(0),
        Privilege.None,
        this.usdcCustody(poolConfig),
        null,
        null,
        owner,
      );
      exitFeeUsd = closeQuoteFeeToUsd6(quote.fees);
      markPriceUsd = contractPriceToNumber(quote.markPrice);
      liqPriceUsd = contractPriceToNumber(quote.existingLiquidationPrice);
    } catch (err) {
      throw new FlashPerpsError("QuoteFailed", String(err));
    }

    const flashSide = sideToFlash(req.side);
    const roiBn = new BN(roiPctToIntegerPercent(req.roiPct));
    let triggerOraclePrice: OraclePrice;
    try {
      triggerOraclePrice = client.getTriggerPriceFromRoiSync(
        roiBn,
        position.collateralUsd,
        exitFeeUsd,
        position.sizeAmount,
        position.sizeDecimals,
        contractPriceToOracle(position.entryPrice),
        flashSide,
      );
    } catch (err) {
      throw new FlashPerpsError("InvalidTrigger", String(err));
    }
    const triggerPrice = triggerOraclePrice.toContractOraclePrice();
    // Pre-flight what the program will enforce (pool.rs): a long SL must sit
    // between liquidation and mark, a long TP above mark — mirrored for
    // shorts. Failing here turns an inevitable on-chain 6049/6050 into a
    // friendly 400 with the actual constraint in the message.
    {
      const t = contractPriceToNumber(triggerPrice);
      const fmt = (v: number) => `$${v.toFixed(2)}`;
      const isLong = req.side === "long";
      if (req.kind === "sl") {
        const aboveMark = isLong ? t >= markPriceUsd : t <= markPriceUsd;
        const pastLiq = isLong ? t <= liqPriceUsd : t >= liqPriceUsd;
        if (aboveMark) {
          throw new FlashPerpsError(
            "InvalidTrigger",
            `stop loss ${fmt(t)} is past the current price ${fmt(markPriceUsd)} — pick a smaller loss`,
          );
        }
        if (pastLiq) {
          throw new FlashPerpsError(
            "InvalidTrigger",
            `stop loss ${fmt(t)} is beyond the liquidation price ${fmt(liqPriceUsd)} — pick a tighter stop`,
          );
        }
      } else {
        const belowMark = isLong ? t <= markPriceUsd : t >= markPriceUsd;
        if (belowMark) {
          throw new FlashPerpsError(
            "InvalidTrigger",
            `take profit ${fmt(t)} is behind the current price ${fmt(markPriceUsd)} — pick a larger gain`,
          );
        }
      }
    }
    const isStopLoss = req.kind === "sl";
    const collateralSymbol = this.collateralSymbolForMarket(poolConfig, market);

    let txData: { instructions: TransactionInstruction[]; additionalSigners: Signer[] };
    try {
      txData =
        req.orderId !== undefined
          ? await client.editTriggerOrder(
              req.market,
              collateralSymbol,
              "USDC",
              flashSide,
              req.orderId,
              triggerPrice,
              position.sizeAmount,
              isStopLoss,
              poolConfig,
            )
          : await client.placeTriggerOrder(
              req.market,
              collateralSymbol,
              "USDC",
              flashSide,
              triggerPrice,
              position.sizeAmount,
              isStopLoss,
              poolConfig,
            );
    } catch (err) {
      throw new FlashPerpsError("BuildTxFailed", String(err));
    }

    const transaction = await this.serializeInstructions(
      poolConfig,
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    return { transaction };
  }

  async buildCancelTriggerOrderTx(
    req: FlashTriggerCancelRequest,
  ): Promise<FlashTriggerTxResponse> {
    const owner = new PublicKey(req.trader);
    const poolConfig = this.poolConfigForMarket(req.market);
    const client = this.createClient(owner, poolConfig);
    const market = this.marketForSymbol(poolConfig, req.market, req.side);
    const collateralSymbol = this.collateralSymbolForMarket(poolConfig, market);
    const flashSide = sideToFlash(req.side);
    const isStopLoss = req.kind === "sl";

    let txData: { instructions: TransactionInstruction[]; additionalSigners: Signer[] };
    try {
      txData = await client.cancelTriggerOrder(
        req.market,
        collateralSymbol,
        flashSide,
        req.orderId,
        isStopLoss,
        poolConfig,
      );
    } catch (err) {
      throw new FlashPerpsError("BuildTxFailed", String(err));
    }

    const transaction = await this.serializeInstructions(
      poolConfig,
      owner,
      txData.instructions,
      txData.additionalSigners,
      client,
    );
    return { transaction };
  }

  async activeTriggersOf(
    trader: string,
  ): Promise<Map<string, TriggerOrderView[]>> {
    const owner = new PublicKey(trader);
    const byPosition = new Map<string, TriggerOrderView[]>();
    for (const poolConfig of this.poolConfigs) {
      const client = this.createClient(owner, poolConfig);
      let accounts: Awaited<ReturnType<PerpetualsClient["getUserOrderAccounts"]>>;
      try {
        accounts = await client.getUserOrderAccounts(owner, poolConfig);
      } catch {
        continue;
      }
      for (const account of accounts) {
        if (!account.isActive) continue;
        const market = poolConfig.markets.find((m) =>
          m.marketAccount.equals(account.market),
        );
        if (!market) continue;
        const positionPk = poolConfig
          .getPositionFromMarketPk(owner, market.marketAccount)
          .toBase58();
        const views: TriggerOrderView[] = [];
        this.collectTriggerViews(account.takeProfitOrders, "tp", views);
        this.collectTriggerViews(account.stopLossOrders, "sl", views);
        if (views.length > 0) {
          byPosition.set(positionPk, [
            ...(byPosition.get(positionPk) ?? []),
            ...views,
          ]);
        }
      }
    }
    return byPosition;
  }

  private collectTriggerViews(
    orders: TriggerOrder[],
    kind: TriggerKind,
    out: TriggerOrderView[],
  ): void {
    orders.forEach((order, index) => {
      const triggerPriceUsd = contractPriceToNumber(order.triggerPrice);
      if (!Number.isFinite(triggerPriceUsd) || triggerPriceUsd <= 0) return;
      // orderId is the 1-based on-chain slot ordinal. getUserOrderAccounts returns
      // the full fixed-size order array including empty slots; the price guard above
      // skips empties WITHOUT renumbering, so `index + 1` stays aligned with the slot
      // that cancelTriggerOrder/editTriggerOrder address. Do NOT rewrite this as
      // `.filter().map()` — that would renumber and break orderId. (Slot ordinal
      // confirmed in the Task 8 smoke check.)
      out.push({ kind, orderId: index + 1, triggerPriceUsd, roiPct: 0 });
    });
  }

  private poolConfigForMarket(symbol: FlashMarketSymbol): PoolConfig {
    const poolName = flashPoolNameForMarket(symbol);
    const poolConfig = poolName ? this.poolConfigByName.get(poolName) : undefined;
    if (!poolConfig) throw new FlashPerpsError("UnsupportedMarket");
    return poolConfig;
  }

  private createClient(
    owner: PublicKey,
    poolConfig: PoolConfig,
  ): PerpetualsClient {
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
      poolConfig.programId,
      poolConfig.perpComposibilityProgramId,
      poolConfig.fbNftRewardProgramId,
      poolConfig.rewardDistributionProgram.programId,
      {},
    );
  }

  private marketForSymbol(
    poolConfig: PoolConfig,
    symbol: FlashMarketSymbol,
    side: FlashSide,
  ): MarketConfig {
    const token = poolConfig.tokens.find((t) => t.symbol === symbol);
    const usdcMint = new PublicKey(USDC_MINT);
    const market = token
      ? poolConfig.markets.find((m) => {
          if (!m.targetMint.equals(token.mintKey)) return false;
          if (!marketMatchesSide(m, side)) return false;
          return side === "long"
            ? !m.collateralMint.equals(usdcMint)
            : m.collateralMint.equals(usdcMint);
        })
      : undefined;
    if (!market) throw new FlashPerpsError("UnsupportedMarket");
    return market;
  }

  private symbolForMarket(
    poolConfig: PoolConfig,
    market: MarketConfig,
  ): FlashMarketSymbol | null {
    const token = poolConfig.tokens.find((t) =>
      t.mintKey.equals(market.targetMint),
    );
    return normalizeFlashMarket(token?.symbol);
  }

  private collateralSymbolForMarket(
    poolConfig: PoolConfig,
    market: MarketConfig,
  ): string {
    return (
      poolConfig.tokens.find((t) => t.mintKey.equals(market.collateralMint))
        ?.symbol ?? "USDC"
    );
  }

  private usdcCustody(poolConfig: PoolConfig): CustodyConfig {
    const custody = poolConfig.custodies.find((c) => c.symbol === "USDC");
    if (!custody) throw new FlashPerpsError("UnsupportedMarket");
    return custody;
  }

  private positionSummary(
    poolConfig: PoolConfig,
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
    const sizeUsd = bnToNumber(position.sizeUsd, USD_DECIMALS);
    const collateralUsd = bnToNumber(position.collateralUsd, USD_DECIMALS);
    return {
      symbol,
      side: sideFromMarket(market),
      positionPubkey: positionPk.toBase58(),
      marketAccount: market.marketAccount.toBase58(),
      entryPriceUsd: contractPriceToNumber(position.entryPrice),
      sizeUsd,
      collateralUsd,
      collateralSymbol: this.collateralSymbolForMarket(poolConfig, market),
      leverage: leverageFromPositionCollateral(sizeUsd, collateralUsd),
      openTime: position.openTime.toNumber() * 1000,
    };
  }

  private async serializeInstructions(
    poolConfig: PoolConfig,
    owner: PublicKey,
    instructions: TransactionInstruction[],
    additionalSigners: Signer[],
    client: PerpetualsClient,
  ): Promise<string> {
    try {
      const blockhash = await this.connection.getLatestBlockhash("finalized");
      const { addressLookupTables } = await client.getOrLoadAddressLookupTable(
        poolConfig,
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
