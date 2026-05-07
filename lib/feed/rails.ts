// Single source of truth for feed-rail metadata. Consumed by both
// the first-run wizard (PreferencesProvider) and the inline toggles
// on the Settings page. Labels are sentence-case here; the wizard
// applies `uppercase` via CSS for its display treatment.
import type { FeedPrefs } from "./preferences";

export interface RailDef {
  num: string;
  key: keyof FeedPrefs;
  label: string;
  description: string;
  /** CSS gradient — used as a vertical stripe in the wizard and a
   *  small dot on the settings page. */
  stripe: string;
  /** Tailwind text colour for [ON] / accent. */
  accent: string;
}

export const RAILS: RailDef[] = [
  {
    num: "01",
    key: "meme",
    label: "Memecoins",
    description: "Trending Solana tokens",
    stripe: "linear-gradient(180deg, hsl(15 95% 55%), hsl(15 80% 35%))",
    accent: "text-orange-300",
  },
  {
    num: "02",
    key: "prediction",
    label: "Predictions",
    description: "Yes / No on real-world events",
    stripe: "linear-gradient(180deg, hsl(220 90% 60%), hsl(220 75% 35%))",
    accent: "text-sky-300",
  },
  {
    num: "03",
    key: "whale",
    label: "Leverage",
    description: "Bet with top traders",
    stripe: "linear-gradient(180deg, hsl(285 80% 60%), hsl(285 65% 35%))",
    accent: "text-purple-300",
  },
];
