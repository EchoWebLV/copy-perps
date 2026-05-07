// Client-side feed personalisation. Stores rail toggles + an
// onboarded flag in localStorage so the wizard only shows once.
//
// Persistence is intentionally local-only for v1: no server round
// trip, no DB column, no migration. When mobile parity ships we
// move this to a `users.feed_prefs` JSONB column and a
// /api/users/me/preferences route — the shape here matches what
// that JSON column will hold.

const PREFS_KEY = "gwak_feed_prefs_v1";
const ONBOARDED_KEY = "gwak_onboarded_v1";

export interface FeedPrefs {
  meme: boolean;
  prediction: boolean;
  whale: boolean;
}

export const DEFAULT_PREFS: FeedPrefs = {
  meme: true,
  prediction: true,
  whale: true,
};

export function getPrefs(): FeedPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<FeedPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(prefs: FeedPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage quota / private mode — silently no-op. The wizard
    // will simply re-show next session.
  }
}

export function hasOnboarded(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDED_KEY) === "true";
}

export function markOnboarded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "true");
  } catch {
    // ignore
  }
}
