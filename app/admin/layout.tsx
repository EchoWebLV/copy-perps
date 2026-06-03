import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdminEnabled } from "@/lib/admin/auth";

export const metadata = {
  title: "Bot Admin · gwak.gg",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isAdminEnabled()) notFound();
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/bots"
              className="text-lg font-semibold tracking-tight text-white hover:text-zinc-200"
            >
              Bot Admin
            </Link>
            <span className="rounded-full border border-amber-800 bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">
              dev only
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/admin/bots"
              className="text-zinc-300 hover:text-white"
            >
              All bots
            </Link>
            <Link
              href="/admin/monitor"
              className="text-zinc-300 hover:text-white"
            >
              Monitor
            </Link>
            <Link
              href="/admin/bots/new"
              className="text-emerald-400 hover:text-emerald-300"
            >
              + Clone variant
            </Link>
            <Link
              href="/feed"
              className="text-zinc-500 hover:text-zinc-300"
            >
              ← Feed
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
