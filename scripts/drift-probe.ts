import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  DriftClient,
  Wallet,
  initialize,
  getUserAccountPublicKey,
  PerpMarkets,
} from "@drift-labs/sdk";

const RPC_URL = process.env.NEXT_PUBLIC_HELIUS_RPC_URL!;

(async () => {
  console.log("RPC:", RPC_URL.slice(0, 50));
  const connection = new Connection(RPC_URL, "confirmed");
  const dummyWallet = new Wallet(Keypair.generate());

  const sdkConfig = initialize({ env: "mainnet-beta" });
  console.log("Program ID:", sdkConfig.DRIFT_PROGRAM_ID);

  const driftClient = new DriftClient({
    connection,
    wallet: dummyWallet,
    programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
    env: "mainnet-beta",
  });

  console.log("Calling subscribe()…");
  const t0 = Date.now();
  try {
    await driftClient.subscribe();
    console.log(`subscribe() took ${Date.now() - t0}ms`);
  } catch (e) {
    console.error("subscribe failed:", e);
    process.exit(1);
  }

  console.log("\nMainnet PerpMarkets count:", PerpMarkets["mainnet-beta"].length);
  const major = PerpMarkets["mainnet-beta"].filter((m) =>
    ["SOL-PERP", "BTC-PERP", "ETH-PERP"].includes(m.symbol),
  );
  major.forEach((m) =>
    console.log(`  ${m.symbol} → marketIndex ${m.marketIndex}`),
  );

  // Test user-account check
  const dummyUser = Keypair.generate().publicKey;
  const userPda = await getUserAccountPublicKey(
    new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
    dummyUser,
    0,
  );
  const exists = await connection.getAccountInfo(userPda);
  console.log("\nDummy user has Drift account?", exists !== null);

  await driftClient.unsubscribe();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
