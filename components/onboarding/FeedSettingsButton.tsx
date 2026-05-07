"use client";

import { SlidersHorizontal } from "lucide-react";
import { usePreferences } from "./PreferencesProvider";

// Floating "edit feed rails" button. Mounted on the feed shell.
// Tapping calls usePreferences().open() — when authed, opens the
// preferences modal in edit mode; when unauthed, falls through to
// the Privy login modal (handled by the provider).
export function FeedSettingsButton() {
  const { open } = usePreferences();
  return (
    <button
      onClick={open}
      aria-label="Edit feed rails"
      className="absolute top-[60px] right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/60 text-neutral-300 backdrop-blur-xl transition active:scale-95 hover:bg-black/80 hover:text-white"
    >
      <SlidersHorizontal size={16} />
    </button>
  );
}
