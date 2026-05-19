import type { ReactNode } from "react";
import { BG, FG, FONT_DISPLAY } from "@/components/v2/ui";
import { DesktopContextRail } from "./DesktopContextRail";
import { DesktopNav } from "./DesktopNav";

export function AppShell({
  children,
  rail,
  railTitle,
  mainClassName = "",
}: {
  children: ReactNode;
  rail?: ReactNode;
  railTitle?: string;
  mainClassName?: string;
}) {
  return (
    <div className="h-full w-full lg:flex lg:h-dvh lg:overflow-hidden" style={{ background: BG, color: FG, fontFamily: FONT_DISPLAY }}>
      <DesktopNav />
      {/* AppShell owns the page main landmark; route children should use div/section. */}
      <main className={`h-full min-h-0 flex-1 ${mainClassName}`}>{children}</main>
      <DesktopContextRail title={railTitle}>{rail}</DesktopContextRail>
    </div>
  );
}
