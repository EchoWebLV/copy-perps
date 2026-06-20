// Read-only: SOL + USDC balance for a wallet. No writes, no signing.
// node --env-file=.env.local scripts/_probe-wallet-balance.mjs <pubkey>
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const owner = process.argv[2] ?? "8xQdV1ga9jXn2gwvHqmfkvuvzo8yVKq9e7bcMWv6ALW2";

const conn = new Connection(RPC, "confirmed");
const pk = new PublicKey(owner);

const lamports = await conn.getBalance(pk);
let usdc = 0;
try {
  const accs = await conn.getParsedTokenAccountsByOwner(pk, { mint: new PublicKey(USDC) });
  for (const a of accs.value) {
    usdc += a.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
  }
} catch (e) {
  usdc = `err: ${e.message}`;
}

console.log(`wallet ${owner}`);
console.log(`  SOL : ${(lamports / 1e9).toFixed(6)}`);
console.log(`  USDC: ${usdc}`);
