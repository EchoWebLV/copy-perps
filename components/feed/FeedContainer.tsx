"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Signal } from "@/lib/types";
import { MemeCard } from "./MemeCard";
import { PredictionCard } from "./PredictionCard";
import { MultiPredictionCard } from "./MultiPredictionCard";
import { WhaleCard } from "./WhaleCard";
import { BalancePill } from "@/components/shell/BalancePill";
import { cardGradient } from "@/lib/feed/card-color";

interface Props {
  signals: Signal[];
}

export function FeedContainer({ signals }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const els = itemRefs.current.filter((el): el is HTMLDivElement => !!el);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = Number((visible.target as HTMLElement).dataset.idx);
        if (Number.isFinite(idx)) setActiveIdx(idx);
      },
      { threshold: [0.6] },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [signals.length]);

  const activeGradient = useMemo(
    () => cardGradient(signals[activeIdx]),
    [signals, activeIdx],
  );

  return (
    <div
      className="relative h-dvh w-full overflow-hidden"
      style={{
        background: activeGradient,
        transition: "background 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <BalancePill />
      <div
        className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll"
        style={{ scrollSnapStop: "always" }}
      >
        {signals.map((signal, i) => (
          <div
            key={signal.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            data-idx={i}
            className="h-dvh w-full snap-start"
          >
            <CardContent signal={signal} active={i === activeIdx} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardContent({ signal, active }: { signal: Signal; active: boolean }) {
  return (
    <div
      className="h-full w-full transition-[transform,opacity] duration-500 ease-out will-change-transform"
      style={{
        transform: active ? "translateY(0) scale(1)" : "translateY(8px) scale(0.985)",
        opacity: active ? 1 : 0.55,
      }}
    >
      {signal.type === "meme" && <MemeCard signal={signal} />}
      {signal.type === "prediction" && <PredictionCard signal={signal} />}
      {signal.type === "multiprediction" && <MultiPredictionCard signal={signal} />}
      {signal.type === "whale" && <WhaleCard signal={signal} />}
    </div>
  );
}
