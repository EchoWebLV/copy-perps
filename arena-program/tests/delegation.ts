// Task 12: ER delegation lifecycle — delegate → tick via the ephemeral
// validator → commit → undelegate → base-layer state matches.
//
// Run via scripts/test-delegation.sh, which starts mb-test-validator (base
// layer with the delegation + magic programs preloaded, feed fixture loaded)
// and @magicblock-labs/ephemeral-validator on :7799, deploys the program and
// sets ARENA_DELEGATION_TEST=1. The suite self-skips in the plain
// `anchor-1.0.2 test --validator legacy` run: solana-test-validator has no
// delegation program and no local ER.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import { assert } from "chai";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Arena } from "../target/types/arena";

const ENABLED = process.env.ARENA_DELEGATION_TEST === "1";

const SOL_FEED = new web3.PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);
// Default identity of the local @magicblock-labs/ephemeral-validator (same
// pubkey anchor-counter pins for its localnet run).
const LOCAL_ER_VALIDATOR = new web3.PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);
// magicblock-delegation-program-api 3.0.0 (the er-sdk 0.14.3 dependency) —
// NOT the older DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteabpTabdBah id.
const DELEGATION_PROGRAM_ID = new web3.PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

const personaId = (name: string): number[] => {
  const buf = Buffer.alloc(16);
  buf.write(name, "ascii");
  return Array.from(buf);
};
const SCALPER_ID = personaId("scalper.v1");
const RIDER_ID = personaId("rider.v1");
const SCALPER_PARAMS = {
  readSpan: 1,
  breakoutBps: 60,
  activityMultBps: 14000,
  trendFilter: 1,
  stakeFracBps: 1000,
  leverage: 100,
  maxHoldTicks: 90,
  exitFavorableBps: 100,
};
const RIDER_PARAMS = {
  readSpan: 4,
  breakoutBps: 80,
  activityMultBps: 14000,
  trendFilter: 1,
  stakeFracBps: 1000,
  leverage: 20,
  maxHoldTicks: 240,
  exitFavorableBps: 150,
};
const START_BALANCE = new BN(1_000_000_000);
// Static fixture: publish_ts never advances, staleness window must be huge.
const MAX_AGE_SECS = new BN("10000000000");

(ENABLED ? describe : describe.skip)("arena ER delegation lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Arena as Program<Arena>;

  const erConnection = new web3.Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "http://localhost:7799",
    {
      wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "ws://localhost:7800",
      commitment: "confirmed",
    },
  );
  const erProvider = new anchor.AnchorProvider(erConnection, provider.wallet, {
    commitment: "confirmed",
  });
  const erProgram = new Program<Arena>(program.idl, erProvider);

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [marketPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from([0])],
    program.programId,
  );
  const [scalperPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bot"), Buffer.from(SCALPER_ID)],
    program.programId,
  );
  const [riderPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("bot"), Buffer.from(RIDER_ID)],
    program.programId,
  );
  const botMetas = [scalperPda, riderPda].map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));

  // anchor-counter's ER send pattern: ER blockhash, wallet signs, ER confirms.
  async function sendViaEr(tx: web3.Transaction): Promise<string> {
    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx = await erProvider.wallet.signTransaction(tx);
    return erProvider.sendAndConfirm(tx, [], { skipPreflight: true });
  }

  it("initializes config, market and both bots on the base layer", async () => {
    await program.methods
      .initConfig(6, 5, 500, MAX_AGE_SECS, new BN(15))
      .accountsPartial({
        config: configPda,
        payer: provider.wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    await program.methods
      .initMarket(0, SOL_FEED)
      .accountsPartial({
        config: configPda,
        marketState: marketPda,
        admin: provider.wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    for (const [id, params] of [
      [SCALPER_ID, SCALPER_PARAMS],
      [RIDER_ID, RIDER_PARAMS],
    ] as const) {
      await program.methods
        .initBot(id as number[], params, START_BALANCE)
        .accountsPartial({
          config: configPda,
          bot: web3.PublicKey.findProgramAddressSync(
            [Buffer.from("bot"), Buffer.from(id as number[])],
            program.programId,
          )[0],
          admin: provider.wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    }
    const ms = await program.account.marketState.fetch(marketPda);
    assert.equal(ms.lastPrice.toString(), "0");
  });

  it("delegates the market and both bots to the ER", async () => {
    const validatorMeta = [
      { pubkey: LOCAL_ER_VALIDATOR, isSigner: false, isWritable: false },
    ];
    await program.methods
      .delegateMarket(0)
      .accountsPartial({
        config: configPda,
        admin: provider.wallet.publicKey,
        marketState: marketPda,
      })
      .remainingAccounts(validatorMeta)
      .rpc({ skipPreflight: true });
    for (const id of [SCALPER_ID, RIDER_ID]) {
      await program.methods
        .delegateBot(id)
        .accountsPartial({
          config: configPda,
          admin: provider.wallet.publicKey,
          botState: web3.PublicKey.findProgramAddressSync(
            [Buffer.from("bot"), Buffer.from(id)],
            program.programId,
          )[0],
        })
        .remainingAccounts(validatorMeta)
        .rpc({ skipPreflight: true });
    }
    for (const pda of [marketPda, scalperPda, riderPda]) {
      const info = await provider.connection.getAccountInfo(pda);
      assert.isTrue(
        info!.owner.equals(DELEGATION_PROGRAM_ID),
        `${pda.toBase58()} should be owned by the delegation program`,
      );
    }
    // Give the ephemeral validator a beat to pick up the delegations
    // (anchor-counter waits 3s after delegating).
    await new Promise((r) => setTimeout(r, 3000));
  });

  it("ticks via the ER and folds a price into the delegated market", async () => {
    const tx = await program.methods
      .tick(0)
      .accountsPartial({
        config: configPda,
        marketState: marketPda,
        feed: SOL_FEED,
      })
      .remainingAccounts(botMetas)
      .transaction();
    await sendViaEr(tx);

    const ms = await erProgram.account.marketState.fetch(marketPda);
    assert.isTrue(ms.lastPrice.gt(new BN(0)), "ER lastPrice should be live");
    assert.equal(ms.ring[ms.head].updates, 1);
  });

  it("commits ER state to the base layer", async () => {
    const erBefore = await erProgram.account.marketState.fetch(marketPda);
    const tx = await program.methods
      .commitState(0)
      .accountsPartial({
        payer: provider.wallet.publicKey,
        marketState: marketPda,
      })
      .remainingAccounts(botMetas)
      .transaction();
    const erSig = await sendViaEr(tx);

    // Wait for the commit to land on the base layer, then compare state.
    const baseSig = await GetCommitmentSignature(erSig, erConnection);
    assert.isString(baseSig);
    const baseMs = await program.account.marketState.fetch(marketPda);
    assert.equal(
      baseMs.lastPrice.toString(),
      erBefore.lastPrice.toString(),
      "committed base-layer lastPrice should match the ER state",
    );
    // Still delegated: commit_state must NOT undelegate.
    const info = await provider.connection.getAccountInfo(marketPda);
    assert.isTrue(info!.owner.equals(DELEGATION_PROGRAM_ID));
  });

  it("undelegates market + bots back to the base layer", async () => {
    const erBefore = await erProgram.account.marketState.fetch(marketPda);
    const tx = await program.methods
      .undelegateAll(0)
      .accountsPartial({
        config: configPda,
        admin: provider.wallet.publicKey,
        marketState: marketPda,
      })
      .remainingAccounts(botMetas)
      .transaction();
    await sendViaEr(tx);

    // Undelegation finalizes on the base layer asynchronously — poll for the
    // owner to flip back to the program.
    let owner: web3.PublicKey | null = null;
    for (let i = 0; i < 30; i++) {
      const info = await provider.connection.getAccountInfo(marketPda);
      owner = info!.owner;
      if (owner.equals(program.programId)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.isTrue(
      owner!.equals(program.programId),
      "market should be owned by the program again after undelegation",
    );
    for (const pda of [scalperPda, riderPda]) {
      const info = await provider.connection.getAccountInfo(pda);
      assert.isTrue(
        info!.owner.equals(program.programId),
        `${pda.toBase58()} should be undelegated`,
      );
    }
    const baseMs = await program.account.marketState.fetch(marketPda);
    assert.equal(baseMs.lastPrice.toString(), erBefore.lastPrice.toString());
    const scalper = await program.account.bot.fetch(scalperPda);
    assert.equal(scalper.balanceMicro.toString(), START_BALANCE.toString());
  });
});
