import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const RPC = process.env.HELIUS_RPC ?? "https://api.mainnet-beta.solana.com";
const SECRET = process.env.WALLET_SECRET;
if (!SECRET) {
  console.error("set WALLET_SECRET env");
  process.exit(1);
}
const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
const pub = kp.publicKey.toBase58();
console.log("pubkey:", pub);

const conn = new Connection(RPC, "confirmed");
const sol = await conn.getBalance(kp.publicKey);
console.log("SOL:", (sol / 1e9).toFixed(6));

const accs = await conn.getParsedTokenAccountsByOwner(kp.publicKey, {
  programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
});
console.log("Token accounts:");
for (const a of accs.value) {
  const i = a.account.data.parsed.info;
  const ui = i.tokenAmount.uiAmountString;
  if (parseFloat(ui) > 0) {
    console.log(`  ${i.mint}  ${ui}`);
  }
}
