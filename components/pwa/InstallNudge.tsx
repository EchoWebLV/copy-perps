"use client";

import { useEffect, useRef, useState } from "react";
import { X, Download, Share } from "lucide-react";
import {
  ACCENT,
  BG,
  DIM,
  FAINT,
  FG,
  FONT_DISPLAY,
  PANEL,
  PANEL_2,
} from "@/components/v2/ui";
import { shouldShowInstallNudge, type NudgeVariant } from "./install-nudge-logic";

const DISMISSED_KEY = "gwak:install-nudge-dismissed";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/**
 * InstallNudge
 *
 * - Android/Chrome: listens for `beforeinstallprompt`, shows a dismissible
 *   card with an "Install" button that calls the stashed prompt.
 * - iOS Safari: detects iOS + non-standalone, shows share-sheet instructions.
 * - Already installed (standalone mode): renders nothing.
 * - Dismissed: renders nothing (persisted in localStorage).
 */
export function InstallNudge() {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [variant, setVariant] = useState<NudgeVariant>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Read dismiss state once on mount
    const alreadyDismissed =
      localStorage.getItem(DISMISSED_KEY) === "true";
    if (alreadyDismissed) {
      setDismissed(true);
      return;
    }

    const standalone = isStandalone();
    const isIOS = isIOSDevice();

    // Decide immediately for iOS (no event to wait for)
    const initial = shouldShowInstallNudge({
      dismissed: alreadyDismissed,
      standalone,
      isIOS,
      hasPrompt: false,
    });
    if (initial) setVariant(initial);

    // Listen for Chrome/Android install prompt
    const handlePrompt = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setVariant(
        shouldShowInstallNudge({
          dismissed: localStorage.getItem(DISMISSED_KEY) === "true",
          standalone: isStandalone(),
          isIOS: isIOSDevice(),
          hasPrompt: true,
        }),
      );
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    return () => window.removeEventListener("beforeinstallprompt", handlePrompt);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
    setVariant(null);
  };

  const handleInstall = async () => {
    if (!promptRef.current) return;
    await promptRef.current.prompt();
    const choice = await promptRef.current.userChoice;
    if (choice.outcome === "accepted") {
      dismiss();
    }
  };

  if (!variant || dismissed) return null;

  return (
    <div
      role="complementary"
      aria-label="Install gwak app"
      className="mx-auto mb-4 w-full max-w-sm rounded-2xl px-4 py-3"
      style={{
        background: PANEL,
        border: `1px solid ${FAINT}`,
        fontFamily: FONT_DISPLAY,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-xl"
          style={{ background: `${ACCENT}22` }}
        >
          {variant === "ios" ? (
            <Share size={16} strokeWidth={2.5} color={ACCENT} />
          ) : (
            <Download size={16} strokeWidth={2.5} color={ACCENT} />
          )}
        </span>

        {/* Copy */}
        <div className="flex-1">
          <p
            className="text-[12px] font-black uppercase tracking-widest"
            style={{ color: FG }}
          >
            Install gwak
          </p>
          {variant === "ios" ? (
            <p
              className="mt-0.5 text-[10px] font-black uppercase tracking-widest leading-relaxed"
              style={{ color: DIM }}
            >
              Tap{" "}
              <span
                className="rounded px-1 py-px"
                style={{ background: PANEL_2, color: FG }}
              >
                Share
              </span>{" "}
              then{" "}
              <span
                className="rounded px-1 py-px"
                style={{ background: PANEL_2, color: FG }}
              >
                Add to Home Screen
              </span>
            </p>
          ) : (
            <p
              className="mt-0.5 text-[10px] font-black uppercase tracking-widest leading-relaxed"
              style={{ color: DIM }}
            >
              Full-screen, with push alerts when your copies move.
            </p>
          )}
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install nudge"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full transition active:scale-95"
          style={{ background: PANEL_2, color: DIM }}
        >
          <X size={13} strokeWidth={2.5} />
        </button>
      </div>

      {/* Install button (Android/Chrome only) */}
      {variant === "android" && (
        <button
          type="button"
          onClick={() => void handleInstall()}
          className="mt-3 w-full rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition active:scale-[0.97]"
          style={{
            background: ACCENT,
            color: BG,
            boxShadow: `0 3px 0 ${ACCENT}99`,
          }}
        >
          Install
        </button>
      )}
    </div>
  );
}
