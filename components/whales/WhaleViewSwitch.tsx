import Link from "next/link";
import { ACCENT, BG, DIM, FAINT, FONT_DISPLAY, PANEL } from "@/components/v2/ui";

export type WhaleView = "roster" | "heat" | "tape";

const VIEWS: { key: WhaleView; label: string; href: string }[] = [
  { key: "roster", label: "Roster", href: "/feed" },
  { key: "heat", label: "Heat", href: "/live" },
  { key: "tape", label: "Tape", href: "/live?mode=swipe" },
];

/** Segmented switch between the three whale surfaces. Heat and Tape lived
 *  on /live with no nav presence at all — this is their way in. */
export function WhaleViewSwitch({
  active,
  className = "",
}: {
  active: WhaleView;
  className?: string;
}) {
  return (
    <nav
      aria-label="Whale views"
      className={`inline-flex items-center gap-1 rounded-full border p-1 ${className}`}
      style={{
        background: PANEL,
        borderColor: FAINT,
        fontFamily: FONT_DISPLAY,
      }}
    >
      {VIEWS.map((view) => {
        const isActive = view.key === active;
        return (
          <Link
            key={view.key}
            href={view.href}
            prefetch={false}
            aria-current={isActive ? "page" : undefined}
            className="rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition active:scale-[0.97]"
            style={{
              background: isActive ? ACCENT : "transparent",
              color: isActive ? BG : DIM,
            }}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
