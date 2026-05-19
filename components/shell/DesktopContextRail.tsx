import type { ReactNode } from "react";
import { DIM, FAINT, FG, FONT_DISPLAY, PANEL } from "@/components/v2/ui";

export function DesktopContextRail({
  children,
  title = "Context",
}: {
  children?: ReactNode;
  title?: string;
}) {
  return (
    <aside
      className="hidden min-h-0 w-[340px] shrink-0 flex-col border-l p-4 xl:flex"
      style={{ borderColor: FAINT, fontFamily: FONT_DISPLAY }}
      aria-label={title}
    >
      <div className="mb-3 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: DIM }}>
        {title}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children ?? (
          <div
            className="rounded-xl p-4 text-[11px] font-black uppercase tracking-widest"
            style={{ background: PANEL, border: `1px solid ${FAINT}`, color: FG }}
          >
            Select a bot or position to see details.
          </div>
        )}
      </div>
    </aside>
  );
}
