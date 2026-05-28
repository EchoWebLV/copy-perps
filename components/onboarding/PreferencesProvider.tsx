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
import {
  DEFAULT_PREFS,
  fetchPrefs,
  savePrefs,
  type FeedPrefs,
} from "@/lib/feed/preferences";
import { RAILS } from "@/lib/feed/rails";
import { ev } from "@/lib/analytics";
import { feedRailPrefsVisible } from "@/lib/client-features";

type Mode = "onboarding" | "edit";

interface Ctx {
  /** Current rail prefs. Defaults to all-on (matches SSR/unauthed). */
  prefs: FeedPrefs;
  /** Optimistically update + persist a new prefs object. Used by the
   *  Settings page checkboxes; wizard uses staged local state. */
  setPrefs: (next: FeedPrefs) => Promise<void>;
  /** Open the preferences modal in edit mode. No-op when unauthed. */
  open: () => void;
  /** Close the modal without saving. */
  close: () => void;
}

const PreferencesContext = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const showRailPrefs = feedRailPrefsVisible();
  const [mode, setMode] = useState<Mode>("onboarding");
  const [openState, setOpenState] = useState(false);
  const [prefs, setLocalPrefs] = useState<FeedPrefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);

  // First-authed-visit auto-trigger. Fetches the user's stored prefs;
  // if onboardingCompletedAt is null, open the wizard in onboarding mode.
  useEffect(() => {
    if (!showRailPrefs) return;
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
  }, [ready, authenticated, getAccessToken, showRailPrefs]);

  const open = useCallback(() => {
    if (!showRailPrefs) return;
    if (!authenticated) {
      login();
      return;
    }
    setMode("edit");
    setOpenState(true);
  }, [authenticated, login, showRailPrefs]);

  const close = useCallback(() => setOpenState(false), []);

  const toggle = (key: keyof FeedPrefs) =>
    setLocalPrefs((p) => ({ ...p, [key]: !p[key] }));

  // Optimistic + persist. Used both by the wizard's Save handler and
  // the inline Settings checkboxes. On failure we log but don't roll
  // back — the next page load will correct from the server.
  const setPrefsAndSave = useCallback(
    async (next: FeedPrefs) => {
      setLocalPrefs(next);
      try {
        const token = await getAccessToken();
        if (!token) return;
        await savePrefs(token, next);
      } catch (e) {
        console.error("[PreferencesProvider] save", e);
      }
    },
    [getAccessToken],
  );

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    await setPrefsAndSave(prefs);
    if (mode === "onboarding") {
      ev.onboardingCompleted({
        meme: prefs.meme,
        prediction: prefs.prediction,
        whale: prefs.whale,
      });
    }
    setOpenState(false);
    setSaving(false);
  };

  const anySelected = prefs.meme || prefs.prediction || prefs.whale;

  return (
    <PreferencesContext.Provider
      value={{ prefs, setPrefs: setPrefsAndSave, open, close }}
    >
      {children}
      {openState && showRailPrefs && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#080808] text-white">
          <div className="mx-auto flex min-h-full max-w-md flex-col px-7 pb-10 pt-14">
            {/* eyebrow + masthead */}
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">
              {mode === "onboarding" ? "// step 01 / first run" : "// preferences"}
            </div>
            <h1 className="mt-5 text-[44px] font-bold leading-[0.95] tracking-tight">
              {mode === "onboarding" ? (
                <>
                  Pick your
                  <br />
                  channels.
                </>
              ) : (
                <>
                  Tune your
                  <br />
                  feed.
                </>
              )}
            </h1>
            <p className="mt-4 max-w-[18rem] text-sm leading-relaxed text-neutral-400">
              {mode === "onboarding"
                ? "Three rails feed the timeline. All on by default — switch off anything you don't care about."
                : "Toggle rails on or off. Saved across devices."}
            </p>

            {/* rail rows */}
            <div className="mt-12 flex flex-col">
              {RAILS.map(({ num, key, label, description, stripe, accent }, i) => {
                const enabled = prefs[key];
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`group relative -mx-7 px-7 py-6 text-left transition-colors ${
                      i === 0 ? "border-t border-white/[0.08]" : ""
                    } border-b border-white/[0.08]`}
                  >
                    {/* gradient stripe at far-left edge — the only colour
                        in the row when off, full-bleed when on. */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[3px] transition-opacity"
                      style={{
                        background: stripe,
                        opacity: enabled ? 1 : 0.25,
                      }}
                    />
                    <div className="flex items-baseline gap-5">
                      <span
                        className={`font-mono text-[11px] tabular-nums tracking-wider transition-colors ${
                          enabled ? "text-white" : "text-neutral-700"
                        }`}
                      >
                        {num}
                      </span>
                      <div className="flex-1">
                        <div
                          className={`text-2xl font-bold uppercase leading-none tracking-tight transition-colors ${
                            enabled ? "text-white" : "text-neutral-600"
                          }`}
                        >
                          {label}
                        </div>
                        <div
                          className={`mt-2 text-[13px] leading-snug transition-colors ${
                            enabled ? "text-neutral-400" : "text-neutral-700"
                          }`}
                        >
                          {description}
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold tracking-[0.15em] transition-colors ${
                          enabled ? accent : "text-neutral-700"
                        }`}
                      >
                        [{enabled ? "ON" : "OFF"}]
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* CTA pinned to bottom of column, mono accent */}
            <div className="mt-auto pt-12">
              {!anySelected && (
                <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400/80">
                  ! pick at least one
                </p>
              )}
              <div className="flex gap-3">
                {mode === "edit" && (
                  <button
                    onClick={close}
                    className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-500 transition hover:text-white"
                  >
                    [esc] cancel
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={!anySelected || saving}
                  className="ml-auto flex items-center gap-3 bg-white px-7 py-4 text-sm font-bold uppercase tracking-[0.15em] text-black transition active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
                >
                  <span>
                    {saving
                      ? "Saving"
                      : mode === "onboarding"
                        ? "Continue"
                        : "Save"}
                  </span>
                  <span className="font-mono">{saving ? "…" : "→"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): Ctx {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    return {
      prefs: DEFAULT_PREFS,
      setPrefs: async () => {},
      open: () => {},
      close: () => {},
    };
  }
  return ctx;
}
