import type { SignalLevel } from "@/lib/types";

const dotClasses: Record<SignalLevel, string> = {
  green: "bg-[#22c55e] shadow-[0_0_8px_#22c55e]",
  amber: "bg-[#f59e0b] shadow-[0_0_8px_#f59e0b]",
  purple: "bg-[#a855f7] shadow-[0_0_8px_#a855f7]",
};

export function SignalChip({ text, level }: { text: string; level: SignalLevel }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-[13px]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses[level]}`} />
      <span>{text}</span>
    </div>
  );
}
