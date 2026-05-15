import Link from "next/link";

export const dynamic = "force-static";

const STYLES = [
  {
    href: "/design/terminal",
    name: "TERMINAL BRUTALISM",
    tag: "Bloomberg × 90s hacker × degen",
    palette: ["#000", "#ffb000", "#00ff66", "#ff0033"],
    blurb:
      "We mean business. Monospace, amber phosphor, dense data, zero ornament. Bots are tickers.",
  },
  {
    href: "/design/hypebeast",
    name: "HYPEBEAST CONCRETE",
    tag: "Off-White × Acne × construction site",
    palette: ["#0a0a0a", "#f3f1ec", "#9a9a9a", "#ffe600"],
    blurb:
      "This is a status object. Massive Helvetica, caution stripes, factory stamps. Bots feel like drops.",
  },
  {
    href: "/design/cyberpunk",
    name: "CYBERPUNK NEO-TOKYO",
    tag: "Akira × Ghost in the Shell × Hyperliquid 2099",
    palette: ["#04020a", "#ff2bd6", "#22e9ff", "#bbff00"],
    blurb:
      "You're in a movie. Neon glow, scanlines, glitch numbers, biometric badges. Operators, not bots.",
  },
];

export default function DesignIndexPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-neutral-950 px-5 py-10 text-white">
      <div className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">
          design exploration
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Pick a style
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Same bot, same data — three radically different skins. Tap to walk
          through each.
        </p>
      </div>

      <div className="space-y-4">
        {STYLES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group block rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition hover:border-white/25 hover:bg-white/[0.04]"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold tracking-wider">{s.name}</h2>
              <span className="text-[10px] text-white/30 group-hover:text-white/60">
                view →
              </span>
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">
              {s.tag}
            </div>
            <p className="mt-3 text-sm leading-snug text-white/70">{s.blurb}</p>
            <div className="mt-3 flex gap-1.5">
              {s.palette.map((c) => (
                <span
                  key={c}
                  className="h-5 w-5 rounded ring-1 ring-white/10"
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </Link>
        ))}
      </div>

      <Link
        href="/feed"
        className="mt-8 inline-block text-[11px] uppercase tracking-wider text-white/40 hover:text-white/70"
      >
        ← back to live feed
      </Link>
    </main>
  );
}
