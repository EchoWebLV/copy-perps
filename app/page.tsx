import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

// Public showcase landing. "Enter the app" points at /feed — the invite
// middleware lets cookie-holders straight in and sends everyone else to
// /invite (code entry + waitlist signup).
export const metadata: Metadata = {
  title: "gwak.gg | copy the whales, copy the AI",
  description:
    "Copy the most profitable whales on Hyperliquid and Pacifica, and frontier AI agents (Opus, Grok, GPT) trading live on-chain. One tap to mirror the trade on Solana. When they close, you close. Automatically.",
};

export default function HomePage() {
  return <Landing />;
}
