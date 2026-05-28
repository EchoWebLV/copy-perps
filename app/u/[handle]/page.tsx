import Link from "next/link";
import { notFound } from "next/navigation";
import { makeProfileCodeColorPattern } from "@/lib/users/profile-code";
import { normalizeHandleInput } from "@/lib/users/handle";

interface PageParams {
  params: Promise<{ handle: string }>;
}

export default async function PublicProfilePage({ params }: PageParams) {
  const { handle: rawHandle } = await params;
  const normalized = normalizeHandleInput(rawHandle);
  if (!normalized.ok) notFound();

  const handle = normalized.handle;
  const pattern = makeProfileCodeColorPattern(handle);

  return (
    <main className="min-h-screen bg-[#0e0d10] px-6 py-10 text-[#fafaf2]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-sm flex-col justify-center">
        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#fafaf2]/55">
          BREACH PROFILE
        </div>
        <h1 className="mt-4 truncate text-[44px] font-black leading-none">
          @{handle}
        </h1>

        <div className="mt-8 grid w-full max-w-[280px] gap-[3px] rounded-2xl bg-gradient-to-br from-[#fafaf2] to-[#fff7a8] p-4 shadow-[0_0_44px_rgba(250,229,0,0.2)]">
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}
          >
            {pattern.flatMap((row, y) =>
              row.map((color, x) => (
                <span
                  key={`${x}:${y}`}
                  className="aspect-square rounded-[2px]"
                  style={{ background: color ?? "rgba(14, 13, 16, 0.06)" }}
                />
              )),
            )}
          </div>
        </div>

        <Link
          href="/feed"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-[#fae500] px-5 text-[12px] font-black uppercase tracking-widest text-[#0e0d10] active:scale-[0.97]"
        >
          OPEN BREACH
        </Link>
      </div>
    </main>
  );
}
