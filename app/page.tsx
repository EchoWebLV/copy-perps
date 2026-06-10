import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

// Public showcase landing. "Enter the app" points at /feed — the invite
// middleware lets cookie-holders straight in and sends everyone else to
// /invite (code entry + waitlist signup).
export const metadata: Metadata = {
  title: "gwak.gg | watch the whales, tail the signal",
  description:
    "Live perp positions from the biggest wallets on Hyperliquid and Pacifica. One tap to copy the trade on Solana. When the whale closes, you close. Automatically.",
};

export default function HomePage() {
  return <Landing />;
}
