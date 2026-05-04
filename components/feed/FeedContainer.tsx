"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Signal } from "@/lib/types";
import { MemeCard } from "./MemeCard";
import { PredictionCard } from "./PredictionCard";
import { MultiPredictionCard } from "./MultiPredictionCard";
import { WhaleCard } from "./WhaleCard";
import { BalancePill } from "@/components/shell/BalancePill";
import { cardGradient } from "@/lib/feed/card-color";

interface Props {
  initialSignals: Signal[];
  initialSeed: string;
  initialCursor: number;
  initialTotal: number;
}

interface FeedResponse {
  signals: Signal[];
  cursor: number;
  nextCursor: number;
  total: number;
  seed: string;
  done: boolean;
}

const PREFETCH_BUFFER = 3; // start fetching this many cards before the end
const BATCH_LIMIT = 10;

export function FeedContainer({
  initialSignals,
  initialSeed,
  initialCursor,
  initialTotal,
}: Props) {
  const [signals, setSignals] = useState<Signal[]>(initialSignals);
  const [seed, setSeed] = useState(initialSeed);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [activeIdx, setActiveIdx] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Stable refs so the fetcher closure always sees the latest values
  // without having to retrigger the IntersectionObserver effect.
  const stateRef = useRef({ signals, seed, cursor, total, loading: false });
  stateRef.current.signals = signals;
  stateRef.current.seed = seed;
  stateRef.current.cursor = cursor;
  stateRef.current.total = total;

  // Track ids already in the feed to dedupe across reshuffles. We seed it
  // from initialSignals so the first reshuffle doesn't duplicate them.
  const seenIdsRef = useRef<Set<string>>(
    new Set(initialSignals.map((s) => s.id)),
  );

  const loadMore = useCallback(async () => {
    if (stateRef.current.loading) return;
    stateRef.current.loading = true;
    try {
      // If we've consumed the current shuffle, request a fresh seed by
      // omitting it; the server picks one and we reset the cursor.
      const exhausted =
        stateRef.current.cursor >= stateRef.current.total &&
        stateRef.current.total > 0;
      const params = new URLSearchParams({
        cursor: exhausted ? "0" : String(stateRef.current.cursor),
        limit: String(BATCH_LIMIT),
      });
      if (!exhausted) params.set("seed", stateRef.current.seed);

      const r = await fetch(`/api/feed?${params}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`feed ${r.status}`);
      const data = (await r.json()) as FeedResponse;

      const fresh = data.signals.filter((s) => !seenIdsRef.current.has(s.id));
      fresh.forEach((s) => seenIdsRef.current.add(s.id));

      setSignals((prev) => [...prev, ...fresh]);
      setSeed(data.seed);
      setCursor(data.nextCursor);
      setTotal(data.total);
    } catch (e) {
      console.error("[feed] loadMore failed:", e);
    } finally {
      stateRef.current.loading = false;
    }
  }, []);

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
        if (!Number.isFinite(idx)) return;

        setActiveIdx(idx);

        if (idx >= stateRef.current.signals.length - PREFETCH_BUFFER) {
          loadMore();
        }
      },
      { threshold: [0.6] },
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [signals.length, loadMore]);

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
