import { BottomNav } from "@/components/shell/BottomNav";

export default function DepositPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center px-6 pt-16 pb-28 text-center">
      <h1 className="text-3xl font-bold">Deposit</h1>
      <p className="mt-3 max-w-sm text-neutral-400">
        Deposit USDC into your Privy Solana wallet. Wired in Phase 1.
      </p>

      <div className="mt-8 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6 text-left">
        <div className="text-[11px] tracking-wider text-neutral-500 uppercase">
          Your Solana address
        </div>
        <div className="mt-2 break-all font-mono text-sm text-neutral-300">
          So1...placeholder...wallet
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
