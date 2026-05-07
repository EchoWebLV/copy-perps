"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { TrendingUp, Target, Fish, Check } from "lucide-react";
import {
  DEFAULT_PREFS,
  hasOnboarded,
  markOnboarded,
  setPrefs,
  type FeedPrefs,
} from "@/lib/feed/preferences";
import { ev } from "@/lib/analytics";

interface RailDef {
  key: keyof FeedPrefs;
  icon: typeof TrendingUp;
  label: string;
  description: string;
}

const RAILS: RailDef[] = [
  {
    key: "meme",
    icon: TrendingUp,
    label: "Memecoins",
    description:
      "Hot Solana meme tokens trending right now. One tap to buy at $5-50 stakes.",
  },
  {
    key: "prediction",
    icon: Target,
    label: "Predictions",
    description:
      "Yes/No markets from Polymarket and Kalshi. Bet on real-world outcomes — politics, sports, crypto.",
  },
  {
    key: "whale",
    icon: Fish,
    label: "Whale plays",
    description:
      "Tail or fade leveraged perp positions from top Hyperliquid traders. Executes on Solana.",
  },
];

export function OnboardingWizard() {
  const { ready, authenticated } = usePrivy();
  const [open, setOpen] = useState(false);
  const [prefs, setLocalPrefs] = useState<FeedPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    if (!ready || !authenticated) return;
    if (!hasOnboarded()) {
      setOpen(true);
    }
  }, [ready, authenticated]);

  if (!open) return null;

  const toggle = (key: keyof FeedPrefs) =>
    setLocalPrefs((p) => ({ ...p, [key]: !p[key] }));

  const handleContinue = () => {
    setPrefs(prefs);
    markOnboarded();
    ev.onboardingCompleted({
      meme: prefs.meme,
      prediction: prefs.prediction,
      whale: prefs.whale,
    });
    setOpen(false);
  };

  const anySelected = prefs.meme || prefs.prediction || prefs.whale;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 px-6 py-10 backdrop-blur">
      <div className="flex w-full max-w-md flex-col">
        <h1 className="text-center text-3xl font-bold">What do you want to see?</h1>
        <p className="mt-3 text-center text-sm text-neutral-400">
          Pick the rails you care about. All on by default — change anytime.
        </p>

        <div className="mt-8 space-y-3">
          {RAILS.map(({ key, icon: Icon, label, description }) => {
            const enabled = prefs[key];
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  enabled
                    ? "border-green-500 bg-green-500/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    size={22}
                    className={enabled ? "text-green-400" : "text-neutral-500"}
                  />
                  <div className="flex-1">
                    <div className="text-base font-semibold">{label}</div>
                    <div className="mt-1 text-xs leading-relaxed text-neutral-400">
                      {description}
                    </div>
                  </div>
                  <div
                    className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                      enabled
                        ? "border-green-500 bg-green-500"
                        : "border-white/30 bg-transparent"
                    }`}
                  >
                    {enabled && <Check size={12} className="text-black" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleContinue}
          disabled={!anySelected}
          className="mt-8 rounded-2xl bg-white px-8 py-4 text-base font-bold text-black transition active:scale-[0.97] disabled:opacity-40"
        >
          Continue
        </button>

        {!anySelected && (
          <p className="mt-3 text-center text-xs text-neutral-500">
            Pick at least one rail to continue.
          </p>
        )}
      </div>
    </div>
  );
}
