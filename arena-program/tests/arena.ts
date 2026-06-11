import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Arena } from "../target/types/arena";

describe("arena", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Arena as Program<Arena>;

  it("pings", async () => {
    // .rpc() throws if the transaction fails, so a returned signature == success.
    const sig = await program.methods.ping().rpc();
    if (!sig || typeof sig !== "string") {
      throw new Error("ping did not return a transaction signature");
    }
  });
});
