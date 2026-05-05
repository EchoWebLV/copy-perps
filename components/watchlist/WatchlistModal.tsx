"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import type { Signal } from "@/lib/types";
import { MemeCard } from "@/components/feed/MemeCard";
import { PredictionCard } from "@/components/feed/PredictionCard";
import { MultiPredictionCard } from "@/components/feed/MultiPredictionCard";
import { WhaleCard } from "@/components/feed/WhaleCard";
import { cardGradient } from "@/lib/feed/card-color";

interface Props {
  signal: Signal | null;
  onClose: () => void;
}

export function WatchlistModal({ signal, onClose }: Props) {
  useEffect(() => {
    if (!signal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signal, onClose]);

  if (!signal) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center"
      onClick={onClose}
      style={{ background: "rgba(0, 0, 0, 0.6)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative h-full w-full overflow-hidden"
        style={{ background: cardGradient(signal) }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-md transition active:scale-90 hover:bg-black/60"
        >
          <X size={16} />
        </button>
        {signal.type === "meme" && <MemeCard signal={signal} />}
        {signal.type === "prediction" && <PredictionCard signal={signal} />}
        {signal.type === "multiprediction" && (
          <MultiPredictionCard signal={signal} />
        )}
        {signal.type === "whale" && <WhaleCard signal={signal} />}
      </div>
    </div>
  );
}
