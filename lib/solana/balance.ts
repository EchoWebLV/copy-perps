import { Connection, PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "@/lib/jupiter/constants";

const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com";

let cachedConnection: Connection | null = null;
function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(RPC_URL, "confirmed");
  }
  return cachedConnection;
}

const usdcMintPubkey = new PublicKey(USDC_MINT);

export async function getUsdcBalance(walletAddress: string): Promise<number> {
  const conn = getConnection();
  const owner = new PublicKey(walletAddress);
  const accs = await conn.getParsedTokenAccountsByOwner(owner, {
    mint: usdcMintPubkey,
  });

  let total = 0;
  for (const acc of accs.value) {
    const data = acc.account.data;
    if (
      data &&
      typeof data === "object" &&
      "parsed" in data &&
      data.parsed &&
      typeof data.parsed === "object"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenAmount = (data.parsed as any).info?.tokenAmount;
      if (typeof tokenAmount?.uiAmount === "number") {
        total += tokenAmount.uiAmount;
      }
    }
  }
  return total;
}

export async function getSolBalance(walletAddress: string): Promise<number> {
  const conn = getConnection();
  const lamports = await conn.getBalance(new PublicKey(walletAddress));
  return lamports / 1_000_000_000;
}
