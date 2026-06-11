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
});
