import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Arena } from "../target/types/arena";

// Devnet SOLUSD feed snapshot, loaded into the local validator at its real
// address via [[test.validator.account]] in Anchor.toml.
export const SOL_FEED = new anchor.web3.PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);

// 16-byte persona ids (zero-padded ascii).
export const personaId = (name: string): number[] => {
  const buf = Buffer.alloc(16);
  buf.write(name, "ascii");
  return Array.from(buf);
};

export const SCALPER_ID = personaId("scalper.v1");
export const RIDER_ID = personaId("rider.v1");

// trendFilter is u8 0/1, not bool: StrategyParams lives inside the zero_copy
// Bot account, and bytemuck Pod has no bool.
export const SCALPER_PARAMS = {
  readSpan: 1,
  breakoutBps: 60,
  activityMultBps: 14000,
  trendFilter: 1,
  stakeFracBps: 1000,
  leverage: 100,
  maxHoldTicks: 90,
  exitFavorableBps: 100,
};

export const RIDER_PARAMS = {
  readSpan: 4,
  breakoutBps: 80,
  activityMultBps: 14000,
  trendFilter: 1,
  stakeFracBps: 1000,
  leverage: 20,
  maxHoldTicks: 240,
  exitFavorableBps: 150,
};

export const START_BALANCE = new BN(1_000_000_000); // $1,000 micro-USD

// The fixture is a static snapshot: its publish_ts never advances, so local
// tests need a staleness window large enough to always pass.
const MAX_AGE_SECS = new BN("10000000000");

describe("arena", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Arena as Program<Arena>;

  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([0])],
    program.programId,
  );
  const [scalperPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bot"), Buffer.from(SCALPER_ID)],
    program.programId,
  );
  const [riderPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bot"), Buffer.from(RIDER_ID)],
    program.programId,
  );

  it("pings", async () => {
    // .rpc() throws if the transaction fails, so a returned signature == success.
    const sig = await program.methods.ping().rpc();
    if (!sig || typeof sig !== "string") {
      throw new Error("ping did not return a transaction signature");
    }
  });

  it("loads the SOLUSD feed fixture into the validator", async () => {
    const info = await provider.connection.getAccountInfo(SOL_FEED);
    assert.isNotNull(info, "feed fixture account missing — check Anchor.toml");
    assert.equal(info!.data.length, 134);
  });

  it("initializes the config", async () => {
    await program.methods
      .initConfig(6, 5, 500, MAX_AGE_SECS, new BN(15))
      .accountsPartial({
        config: configPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.arenaConfig.fetch(configPda);
    assert.isTrue(cfg.admin.equals(provider.wallet.publicKey));
    assert.equal(cfg.feeBps, 6);
    assert.equal(cfg.spreadBps, 5);
    assert.equal(cfg.maintBufferBps, 500);
    assert.equal(cfg.maxAgeSecs.toString(), MAX_AGE_SECS.toString());
    assert.equal(cfg.bucketSecs.toString(), "15");
    assert.isFalse(cfg.markets.some((m: { active: boolean }) => m.active));
  });

  it("initializes the SOL market pointing at the feed fixture", async () => {
    await program.methods
      .initMarket(0, SOL_FEED)
      .accountsPartial({
        config: configPda,
        marketState: marketPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.arenaConfig.fetch(configPda);
    assert.equal(cfg.markets[0].marketId, 0);
    assert.isTrue(cfg.markets[0].active);
    assert.isTrue(cfg.markets[0].feed.equals(SOL_FEED));

    const ms = await program.account.marketState.fetch(marketPda);
    assert.equal(ms.marketId, 0);
    assert.equal(ms.lastPrice.toString(), "0");
    assert.equal(ms.head, 0);
  });

  it("initializes both bots and round-trips their params", async () => {
    await program.methods
      .initBot(SCALPER_ID, SCALPER_PARAMS, START_BALANCE)
      .accountsPartial({
        config: configPda,
        bot: scalperPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    await program.methods
      .initBot(RIDER_ID, RIDER_PARAMS, START_BALANCE)
      .accountsPartial({
        config: configPda,
        bot: riderPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const scalper = await program.account.bot.fetch(scalperPda);
    assert.deepEqual(scalper.personaId, SCALPER_ID);
    assert.deepEqual(scalper.params, SCALPER_PARAMS);
    assert.equal(scalper.balanceMicro.toString(), START_BALANCE.toString());
    assert.equal(scalper.equityHighMicro.toString(), START_BALANCE.toString());
    assert.equal(scalper.trades, 0);
    assert.equal(scalper.seq.toString(), "0");

    const rider = await program.account.bot.fetch(riderPda);
    assert.deepEqual(rider.personaId, RIDER_ID);
    assert.deepEqual(rider.params, RIDER_PARAMS);
    assert.equal(rider.balanceMicro.toString(), START_BALANCE.toString());
  });

  const botMetas = [scalperPda, riderPda].map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));

  it("rejects a tick whose feed does not match the market config", async () => {
    try {
      await program.methods
        .tick(0)
        .accountsPartial({
          config: configPda,
          marketState: marketPda,
          feed: configPda, // any existing account that is not the configured feed
        })
        .remainingAccounts(botMetas)
        .rpc();
      assert.fail("expected WrongFeed");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "WrongFeed");
    }
  });

  it("ticks: folds the oracle price into the ring", async () => {
    await program.methods
      .tick(0)
      .accountsPartial({
        config: configPda,
        marketState: marketPda,
        feed: SOL_FEED,
      })
      .remainingAccounts(botMetas)
      .rpc();

    const ms = await program.account.marketState.fetch(marketPda);
    assert.isTrue(ms.lastPrice.gt(new BN(0)), "lastPrice should be live");
    assert.isTrue(ms.lastPublishTs.gt(new BN(0)));
    assert.equal(ms.head, 0); // first bucket is the in-progress head
    const bucket = ms.ring[0];
    assert.equal(bucket.updates, 1);
    assert.isTrue(bucket.open.eq(ms.lastPrice));
    assert.isTrue(bucket.close.eq(ms.lastPrice));
    assert.isTrue(bucket.startTs.gt(new BN(0)));
  });

  it("double tick on the same publish_ts is a pure no-op (spam-aging guard)", async () => {
    // The fixture price/publish_ts are static, so the second tick sees a
    // print no newer than the one already folded. The spam-aging guard
    // (pre-mainnet gate, PINS.md review Issue 2) must turn it into a pure
    // no-op success: no candle fold (updates/pathLen frozen), no head roll
    // — and because the guard returns before paper maintenance, no
    // ticks_held aging. Spam ticks between oracle pushes change nothing.
    const msBefore = await program.account.marketState.fetch(marketPda);
    const botsBefore = await Promise.all(
      [scalperPda, riderPda].map((pda) => program.account.bot.fetch(pda)),
    );
    await program.methods
      .tick(0)
      .accountsPartial({
        config: configPda,
        marketState: marketPda,
        feed: SOL_FEED,
      })
      .remainingAccounts(botMetas)
      .rpc();

    const ms = await program.account.marketState.fetch(marketPda);
    assert.equal(ms.head, msBefore.head);
    assert.equal(
      ms.ring[ms.head].updates,
      msBefore.ring[msBefore.head].updates, // NOT +1: the fold never ran
    );
    assert.isTrue(
      ms.ring[ms.head].pathLen.eq(msBefore.ring[msBefore.head].pathLen),
    );
    assert.isTrue(ms.lastPrice.eq(msBefore.lastPrice));
    assert.isTrue(ms.lastPublishTs.eq(msBefore.lastPublishTs));

    // Bots byte-identical: no tape, no trades, no balance moves — and every
    // position slot's ticksHeld untouched (the griefing vector the guard
    // closes: max_hold_ticks personas decaying on attacker-paid ticks).
    for (const [i, pda] of [scalperPda, riderPda].entries()) {
      const bot = await program.account.bot.fetch(pda);
      const before = botsBefore[i];
      assert.equal(bot.seq.toString(), before.seq.toString());
      assert.equal(bot.tapeHead, before.tapeHead);
      assert.equal(bot.trades, before.trades);
      assert.equal(bot.balanceMicro.toString(), before.balanceMicro.toString());
      bot.positions.forEach(
        (p: { active: number; ticksHeld: number }, slot: number) => {
          assert.equal(p.active, before.positions[slot].active);
          assert.equal(p.ticksHeld, before.positions[slot].ticksHeld);
        },
      );
      assert.isTrue(
        bot.positions.every((p: { active: number }) => p.active === 0),
      );
    }
  });

  it("rejects delegation without a pinned ER validator", async () => {
    // The validator pin rides as the first remaining account; forgetting it
    // must fail loudly (MissingValidator) instead of delegating unpinned.
    // The require! fires before the delegation CPI, so this asserts on the
    // legacy validator even though no delegation program is deployed here.
    try {
      await program.methods
        .delegateMarket(0)
        .accountsPartial({
          config: configPda,
          admin: provider.wallet.publicKey,
          marketState: marketPda,
        })
        .rpc();
      assert.fail("expected MissingValidator");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "MissingValidator");
    }
  });

  it("initializes the crank payer PDA", async () => {
    const [crankPayerPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("crank-payer")],
      program.programId,
    );
    await program.methods
      .initCrankPayer()
      .accountsPartial({
        config: configPda,
        crankPayer: crankPayerPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const info = await provider.connection.getAccountInfo(crankPayerPda);
    assert.isNotNull(info);
    assert.isTrue(
      info!.owner.equals(program.programId),
      "crank payer must be program-owned (delegatable)",
    );
    assert.isAbove(info!.lamports, 0, "rent-exempt lamports expected");
    const cp = await program.account.crankPayer.fetch(crankPayerPda);
    assert.isAbove(cp.bump, 0);
  });

  it("rejects crank-payer delegation without a pinned ER validator", async () => {
    // Same rule as delegate_market: the require! fires before the delegation
    // CPI, so it asserts on the legacy validator with no delegation program.
    const [crankPayerPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("crank-payer")],
      program.programId,
    );
    try {
      await program.methods
        .delegateCrankPayer()
        .accountsPartial({
          config: configPda,
          admin: provider.wallet.publicKey,
          crankPayer: crankPayerPda,
        })
        .rpc();
      assert.fail("expected MissingValidator");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "MissingValidator");
    }
  });

  it("rejects bot params outside the domain", async () => {
    try {
      await program.methods
        .initBot(personaId("bad.span"), { ...SCALPER_PARAMS, readSpan: 2 }, START_BALANCE)
        .accountsPartial({
          config: configPda,
          bot: anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("bot"), Buffer.from(personaId("bad.span"))],
            program.programId,
          )[0],
          admin: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected BadParams");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "BadParams");
    }
  });

  // ───────────────────── LLM oracle-bot tier (apply_decision) ──────────────
  // Runs on the plain local validator (no ER): apply_decision reads the static
  // feed fixture and mutates the LlmBot account directly. Verifies the on-chain
  // safety floor + operator-signer enforcement at runtime.
  const LLM_ID = personaId("llm.v1");
  const [llmPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("llmbot"), Buffer.from(LLM_ID)],
    program.programId,
  );
  const operator = anchor.web3.Keypair.generate();
  const LLM_PARAMS = {
    maxHoldTicks: 1000,
    decisionCooldownSecs: 240,
    maxLeverage: 15,
    minStopBps: 50,
    maxStopBps: 500,
    maxStakeFracBps: 2000,
    maxTradesPerDay: 5,
    dailyLossLimitBps: 1500,
    fundingBpsPerHour: 2,
    confidenceFloor: 55,
    riskSizing: 0,
  };
  // action 0 HOLD / 1 OPEN / 2 CLOSE; side 0 long / 1 short.
  const openIx = (
    over: Partial<{ side: number; lev: number; stake: number; stop: number; tp: number; conf: number }> = {},
  ) =>
    program.methods.applyDecision(
      0,
      1,
      over.side ?? 0,
      over.lev ?? 10,
      over.stake ?? 1000,
      over.stop ?? 200,
      over.tp ?? 400,
      over.conf ?? 80,
    );

  it("inits an LLM oracle bot with its operator", async () => {
    await program.methods
      .initLlmBot(LLM_ID, operator.publicKey, LLM_PARAMS, START_BALANCE)
      .accountsPartial({
        config: configPda,
        llmBot: llmPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    const bot = await program.account.llmBot.fetch(llmPda);
    assert.equal(bot.operator.toBase58(), operator.publicKey.toBase58());
    assert.equal(bot.balanceMicro.toString(), START_BALANCE.toString());
  });

  it("rejects apply_decision from a non-operator signer", async () => {
    const stranger = anchor.web3.Keypair.generate();
    try {
      await openIx()
        .accountsPartial({ config: configPda, feed: SOL_FEED, llmBot: llmPda, operator: stranger.publicKey })
        .signers([stranger])
        .rpc();
      assert.fail("expected NotOperator");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "NotOperator");
    }
  });

  it("rejects an OPEN without a stop loss", async () => {
    try {
      await openIx({ stop: 0 })
        .accountsPartial({ config: configPda, feed: SOL_FEED, llmBot: llmPda, operator: operator.publicKey })
        .signers([operator])
        .rpc();
      assert.fail("expected StopRequired");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "StopRequired");
    }
  });

  it("opens a position and clamps leverage to maxLeverage", async () => {
    await openIx({ lev: 999 })
      .accountsPartial({ config: configPda, feed: SOL_FEED, llmBot: llmPda, operator: operator.publicKey })
      .signers([operator])
      .rpc();
    const bot = await program.account.llmBot.fetch(llmPda);
    const pos = bot.positions.find((p: any) => p.active === 1);
    assert.ok(pos, "expected an open position");
    assert.equal(pos.leverage, 15); // clamped from 999
    assert.equal(pos.side, 0);
    assert.equal(bot.tradesToday, 1);
    assert.ok(pos.stopPrice.gt(new BN(0)), "stop set");
  });

  it("rejects a second OPEN inside the cooldown window", async () => {
    try {
      await openIx()
        .accountsPartial({ config: configPda, feed: SOL_FEED, llmBot: llmPda, operator: operator.publicKey })
        .signers([operator])
        .rpc();
      assert.fail("expected Cooldown");
    } catch (err: any) {
      assert.equal(err?.error?.errorCode?.code, "Cooldown");
    }
  });

  it("closes the open position on a CLOSE decision", async () => {
    await program.methods
      .applyDecision(0, 2, 0, 0, 0, 0, 0, 0) // CLOSE
      .accountsPartial({ config: configPda, feed: SOL_FEED, llmBot: llmPda, operator: operator.publicKey })
      .signers([operator])
      .rpc();
    const bot = await program.account.llmBot.fetch(llmPda);
    assert.equal(bot.positions.filter((p: any) => p.active === 1).length, 0);
    assert.equal(bot.trades, 1);
  });
});
