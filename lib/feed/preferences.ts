// Client-side wrapper over the /api/users/me/preferences endpoint.
// Source of truth lives on the users table (feed_prefs JSONB +
// onboarding_completed_at). All callers must be authed — for unauthed
// (public-feed) viewers, fall back to DEFAULT_PREFS without calling.

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

export interface PrefsResponse {
  prefs: FeedPrefs;
  onboardingCompletedAt: string | null;
}

export async function fetchPrefs(token: string): Promise<PrefsResponse> {
  const r = await fetch("/api/users/me/preferences", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`prefs fetch ${r.status}`);
  return (await r.json()) as PrefsResponse;
}

export async function savePrefs(
  token: string,
  prefs: FeedPrefs,
): Promise<PrefsResponse> {
  const r = await fetch("/api/users/me/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(prefs),
  });
  if (!r.ok) throw new Error(`prefs save ${r.status}`);
  return (await r.json()) as PrefsResponse;
}
