"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { TrendingUp, Target, Fish, Check } from "lucide-react";
import {
  DEFAULT_PREFS,
  fetchPrefs,
  savePrefs,
  type FeedPrefs,
} from "@/lib/feed/preferences";
import { ev } from "@/lib/analytics";

type Mode = "onboarding" | "edit";

interface Ctx {
  /** Current rail prefs. Defaults to all-on (matches SSR/unauthed). */
  prefs: FeedPrefs;
  /** Open the preferences modal in edit mode. No-op when unauthed. */
  open: () => void;
  /** Close the modal without saving. */
  close: () => void;
}

const PreferencesContext = createContext<Ctx | null>(null);

interface RailDef {
  key: keyof FeedPrefs;
  icon: typeof TrendingUp;
  label: string;
  description: string;
  gradient: string;
  accent: string;
}

const RAILS: RailDef[] = [
  {
    key: "meme",
    icon: TrendingUp,
    label: "Memecoins",
    description: "Trending Solana memes",
    gradient:
      "radial-gradient(ellipse at top right, hsl(15 85% 30%), hsl(15 60% 8%) 80%)",
    accent: "text-orange-300",
  },
  {
    key: "prediction",
    icon: Target,
    label: "Predictions",
    description: "Yes/No on real-world events",
    gradient:
      "radial-gradient(ellipse at top right, hsl(220 75% 30%), hsl(220 60% 8%) 80%)",
    accent: "text-sky-300",
  },
  {
    key: "whale",
    icon: Fish,
    label: "Whale plays",
    description: "Tail or fade top traders",
    gradient:
      "radial-gradient(ellipse at top right, hsl(285 70% 30%), hsl(285 50% 8%) 80%)",
    accent: "text-purple-300",
  },
];

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [mode, setMode] = useState<Mode>("onboarding");
  const [openState, setOpenState] = useState(false);
  const [prefs, setLocalPrefs] = useState<FeedPrefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  // First-authed-visit auto-trigger. Fetches the user's stored prefs;
  // if onboardingCompletedAt is null, open the wizard in onboarding mode.
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        const data = await fetchPrefs(token);
        if (cancelled) return;
        setLocalPrefs(data.prefs);
        if (!data.onboardingCompletedAt) {
          setMode("onboarding");
          setOpenState(true);
        }
      } catch (e) {
        console.error("[PreferencesProvider] fetch", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, getAccessToken]);

  const open = useCallback(() => {
    if (!authenticated) {
      login();
      return;
    }
    setMode("edit");
    setOpenState(true);
  }, [authenticated, login]);

  const close = useCallback(() => setOpenState(false), []);

  const toggle = (key: keyof FeedPrefs) =>
    setLocalPrefs((p) => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setSaving(false);
        return;
      }
      await savePrefs(token, prefs);
      if (mode === "onboarding") {
        ev.onboardingCompleted({
          meme: prefs.meme,
          prediction: prefs.prediction,
          whale: prefs.whale,
        });
      }
      setOpenState(false);
    } catch (e) {
      console.error("[PreferencesProvider] save", e);
    } finally {
      setSaving(false);
    }
  };

  const anySelected = prefs.meme || prefs.prediction || prefs.whale;

  return (
    <PreferencesContext.Provider value={{ prefs, open, close }}>
      {children}
      {openState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 px-6 py-10 backdrop-blur">
          <div className="flex w-full max-w-md flex-col">
            <h1 className="text-center text-3xl font-bold">
              {mode === "onboarding"
                ? "What do you want to see?"
                : "Feed preferences"}
            </h1>
            <p className="mt-3 text-center text-sm text-neutral-400">
              {mode === "onboarding"
                ? "Pick the rails you care about. All on by default — change anytime."
                : "Toggle rails on or off. Saved across devices."}
            </p>

            <div className="mt-8 space-y-3">
              {RAILS.map(({ key, icon: Icon, label, description, gradient, accent }) => {
                const enabled = prefs[key];
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    style={{
                      background: gradient,
                      filter: enabled ? "none" : "saturate(0.25) brightness(0.55)",
                    }}
                    className={`relative w-full overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200 ${
                      enabled ? "border-white/25" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <Icon
                        size={26}
                        className={enabled ? accent : "text-neutral-400"}
                      />
                      <div className="flex-1">
                        <div className="text-base font-semibold text-white">
                          {label}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-300">
                          {description}
                        </div>
                      </div>
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                          enabled
                            ? "border-white bg-white"
                            : "border-white/30 bg-transparent"
                        }`}
                      >
                        {enabled && (
                          <Check
                            size={14}
                            className="text-black"
                            strokeWidth={3}
                          />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 flex gap-3">
              {mode === "edit" && (
                <button
                  onClick={close}
                  className="flex-1 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-base font-semibold text-white transition active:scale-[0.97]"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!anySelected || saving}
                className="flex-1 rounded-2xl bg-white px-8 py-4 text-base font-bold text-black transition active:scale-[0.97] disabled:opacity-40"
              >
                {saving
                  ? "Saving…"
                  : mode === "onboarding"
                    ? "Continue"
                    : "Save"}
              </button>
            </div>

            {!anySelected && (
              <p className="mt-3 text-center text-xs text-neutral-500">
                Pick at least one rail.
              </p>
            )}
          </div>
        </div>
      )}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): Ctx {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    return { prefs: DEFAULT_PREFS, open: () => {}, close: () => {} };
  }
  return ctx;
}
