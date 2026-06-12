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
import {
  delegationRecordPdaFromDelegatedAccount,
  magicFeeVaultPdaFromValidator,
} from "@magicblock-labs/ephemeral-rollups-sdk";
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
  const [crankPayerPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("crank-payer")],
    program.programId,
  );
  // commit_state's fee-vault accounts (magic_fee_vault + delegated payer —
  // PINS.md "magic_fee_vault commits"): the delegation record of the
  // committed market and the fee vault of the validator it is delegated to,
  // both PDAs under the delegation program.
  const marketDelegationRecord =
    delegationRecordPdaFromDelegatedAccount(marketPda);
  const magicFeeVault = magicFeeVaultPdaFromValidator(LOCAL_ER_VALIDATOR);
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

  // Plural GetCommitmentSignature (the SDK helper only parses the FIRST
  // "ScheduledCommitSent signature: " log line). Since the per-account
  // intent fix (PINS.md "magic_fee_vault commits", 2026-06-12 incident) one
  // commit/undelegate ER tx schedules N independent single-account intents,
  // each logging its own scheduling line and finalizing as its OWN
  // base-layer tx — multi-account bundles exceeded the validator's
  // base-layer compute budget and retried forever.
  async function getCommitmentSignatures(erSig: string): Promise<string[]> {
    const scheduling = await erConnection.getTransaction(erSig, {
      maxSupportedTransactionVersion: 0,
    });
    // Operational breadcrumb for the defensive CU note in commit_state: how
    // much ER compute the N scheduling CPIs cost in this one instruction.
    console.log(
      `      scheduling ER tx consumed ${scheduling?.meta?.computeUnitsConsumed ?? "?"} CU`,
    );
    const logs = scheduling?.meta?.logMessages ?? [];
    const prefix = "ScheduledCommitSent signature: ";
    const scheduledSigs = logs
      .filter((l) => l.includes(prefix))
      .map((l) => l.split(prefix)[1]);
    assert.isAbove(
      scheduledSigs.length,
      0,
      `no scheduled commit intents in ER logs:\n${logs.join("\n")}`,
    );
    const baseSigs: string[] = [];
    for (const sig of scheduledSigs) {
      // The ScheduledCommitSent record lands on the ER asynchronously once
      // the validator realizes the intent on the base layer — poll for it.
      let sent = null;
      for (let i = 0; i < 75 && !sent; i++) {
        sent = await erConnection.getTransaction(sig, {
          maxSupportedTransactionVersion: 0,
        });
        if (!sent) await new Promise((r) => setTimeout(r, 200));
      }
      assert.isNotNull(sent, `ScheduledCommitSent tx ${sig} never landed on the ER`);
      const sentLogs = sent!.meta?.logMessages ?? [];
      const basePrefix = "ScheduledCommitSent signature[0]: ";
      const base = sentLogs
        .find((l) => l.includes(basePrefix))
        ?.split(basePrefix)[1];
      assert.isString(
        base,
        `no base-layer signature in ScheduledCommitSent logs:\n${sentLogs.join("\n")}`,
      );
      baseSigs.push(base!);
    }
    return baseSigs;
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

  it("initializes, funds and delegates the crank payer", async () => {
    await program.methods
      .initCrankPayer()
      .accountsPartial({
        config: configPda,
        crankPayer: crankPayerPda,
        admin: provider.wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    // Fund BEFORE delegating: base-layer lamports ride into the ER as the
    // payer's spendable balance (devnet top-ups after delegation go through
    // scripts/arena/fund-crank-payer.ts's lamports shuttle instead — the
    // local base validator has no ephemeral SPL token program to run it).
    const fundTx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: crankPayerPda,
        lamports: 100_000_000, // 0.1 SOL of commit budget
      }),
    );
    await provider.sendAndConfirm(fundTx);

    await program.methods
      .delegateCrankPayer()
      .accountsPartial({
        config: configPda,
        admin: provider.wallet.publicKey,
        crankPayer: crankPayerPda,
      })
      .remainingAccounts([
        { pubkey: LOCAL_ER_VALIDATOR, isSigner: false, isWritable: false },
      ])
      .rpc({ skipPreflight: true });

    const info = await provider.connection.getAccountInfo(crankPayerPda);
    assert.isTrue(
      info!.owner.equals(DELEGATION_PROGRAM_ID),
      "crank payer should be owned by the delegation program",
    );
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

  it("rejects a commit whose fee vault does not match the validator", async () => {
    // A vault derived from any other "validator" must trip InvalidFeeVault
    // (the handler re-derives from the market's delegation record). Sent
    // raw + status-polled: anchor's sendAndConfirm mangles ER-side failures
    // into an opaque "Unknown action" error, hiding the program log.
    const bogusVault = magicFeeVaultPdaFromValidator(provider.wallet.publicKey);
    let tx = await program.methods
      .commitState(0)
      .accountsPartial({
        payer: provider.wallet.publicKey,
        marketState: marketPda,
        delegationRecord: marketDelegationRecord,
        magicFeeVault: bogusVault,
        crankPayer: crankPayerPda,
      })
      .remainingAccounts(botMetas)
      .transaction();
    tx.feePayer = erProvider.wallet.publicKey;
    tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
    tx = await erProvider.wallet.signTransaction(tx);
    const sig = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    let err: unknown = null;
    for (let i = 0; i < 30; i++) {
      const st = (await erConnection.getSignatureStatus(sig)).value;
      if (st?.err) {
        err = st.err;
        break;
      }
      if (st?.confirmationStatus) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.isNotNull(err, "commit with a bogus fee vault must fail");
    const logs =
      (await erConnection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      }))?.meta?.logMessages ?? [];
    assert.isTrue(
      logs.some((l) => l.includes("InvalidFeeVault")),
      `expected InvalidFeeVault in logs:\n${logs.join("\n")}`,
    );
  });

  it("commits ER state to the base layer via per-account fee-vault intents", async () => {
    const erBefore = await erProgram.account.marketState.fetch(marketPda);
    const payerBefore = await erConnection.getBalance(crankPayerPda);
    const tx = await program.methods
      .commitState(0)
      .accountsPartial({
        payer: provider.wallet.publicKey,
        marketState: marketPda,
        delegationRecord: marketDelegationRecord,
        magicFeeVault,
        crankPayer: crankPayerPda,
      })
      .remainingAccounts(botMetas)
      .transaction();
    const erSig = await sendViaEr(tx);

    // ONE intent per account: market + each bot must each schedule its own
    // intent and finalize as its own base-layer tx. A single multi-account
    // bundle is the ComputationalBudget failure mode this guards against
    // (PINS.md 2026-06-12 incident, MagicBlock-confirmed).
    const baseSigs = await getCommitmentSignatures(erSig);
    assert.equal(
      baseSigs.length,
      1 + botMetas.length,
      "expected one commit intent per account (market + each bot)",
    );
    assert.equal(
      new Set(baseSigs).size,
      baseSigs.length,
      "per-account intents must finalize as distinct base-layer txs",
    );
    // Every per-account commit tx must actually land (and succeed) on base.
    // commitment is explicit: the base provider connection defaults to
    // `processed`, which getTransaction rejects.
    for (const sig of baseSigs) {
      let baseTx = null;
      for (let i = 0; i < 30 && !baseTx; i++) {
        baseTx = await provider.connection.getTransaction(sig, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        if (!baseTx) await new Promise((r) => setTimeout(r, 500));
      }
      assert.isNotNull(baseTx, `base-layer commit tx ${sig} not found`);
      assert.isNull(
        baseTx!.meta?.err ?? null,
        `base-layer commit tx ${sig} failed: ${JSON.stringify(baseTx!.meta?.err)}`,
      );
    }
    const baseMs = await program.account.marketState.fetch(marketPda);
    assert.equal(
      baseMs.lastPrice.toString(),
      erBefore.lastPrice.toString(),
      "committed base-layer lastPrice should match the ER state",
    );
    // Still delegated: commit_state must NOT undelegate.
    const info = await provider.connection.getAccountInfo(marketPda);
    assert.isTrue(info!.owner.equals(DELEGATION_PROGRAM_ID));
    // The bundle payer is the crank-payer PDA: its ER balance must not have
    // grown (paid path debits it; the sponsored path would leave it intact —
    // we log rather than assert an exact fee, which is validator-specific).
    const payerAfter = await erConnection.getBalance(crankPayerPda);
    console.log(
      `      crank payer ER balance: ${payerBefore} -> ${payerAfter} (delta ${payerAfter - payerBefore})`,
    );
    assert.isAtMost(payerAfter, payerBefore, "payer must not gain lamports");
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
