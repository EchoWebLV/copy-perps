import { BottomNav } from "@/components/shell/BottomNav";

export default function HistoryPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center px-6 pt-16 pb-28 text-center">
      <h1 className="text-3xl font-bold">History</h1>
      <p className="mt-3 max-w-sm text-neutral-400">
        Your bets will show up here. Wired in Phase 1.
      </p>

      <div className="mt-8 flex w-full max-w-sm flex-col gap-2 text-left">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
          >
            <div className="text-[11px] text-neutral-500">No bets yet</div>
          </div>
        ))}
      </div>

      <BottomNav />
    </main>
  );
}
