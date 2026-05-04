"use client";

import type { Signal } from "@/lib/types";
import { MemeCard } from "./MemeCard";
import { PredictionCard } from "./PredictionCard";
import { WhaleCard } from "./WhaleCard";
import { BalancePill } from "@/components/shell/BalancePill";

interface Props {
  signals: Signal[];
}

export function FeedContainer({ signals }: Props) {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      <BalancePill />
      <div
        className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll"
        style={{ scrollSnapStop: "always" }}
      >
        {signals.map((signal) => (
          <div key={signal.id} className="h-dvh w-full snap-start">
            {signal.type === "meme" && <MemeCard signal={signal} />}
            {signal.type === "prediction" && <PredictionCard signal={signal} />}
            {signal.type === "whale" && <WhaleCard signal={signal} />}
          </div>
        ))}
      </div>
    </div>
  );
}
