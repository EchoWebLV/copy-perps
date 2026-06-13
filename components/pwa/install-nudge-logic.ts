/**
 * Pure decision function — no browser APIs, fully unit-testable.
 *
 * Returns:
 *  "android" — show the native beforeinstallprompt nudge
 *  "ios"     — show the share-sheet instructions for iOS Safari
 *  null      — already installed, dismissed, or no path to install
 */
export type NudgeVariant = "android" | "ios" | null;

export interface NudgeContext {
  /** localStorage key was set (user dismissed the nudge) */
  dismissed: boolean;
  /** window.matchMedia('(display-mode: standalone)').matches OR navigator.standalone */
  standalone: boolean;
  /** iOS device (no beforeinstallprompt, needs share-sheet instructions) */
  isIOS: boolean;
  /** beforeinstallprompt was fired and stashed */
  hasPrompt: boolean;
}

export function shouldShowInstallNudge(ctx: NudgeContext): NudgeVariant {
  // Never show once installed or dismissed
  if (ctx.standalone || ctx.dismissed) return null;

  // Chrome/Android/Edge — native install flow
  if (ctx.hasPrompt) return "android";

  // iOS Safari — no beforeinstallprompt, manual share-sheet path
  if (ctx.isIOS) return "ios";

  return null;
}
