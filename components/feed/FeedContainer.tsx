"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Signal, SignalType } from "@/lib/types";
import { MemeCard } from "./MemeCard";
import { PredictionCard } from "./PredictionCard";
import { MultiPredictionCard } from "./MultiPredictionCard";
import { WhaleCard } from "./WhaleCard";
import { BalancePill } from "@/components/shell/BalancePill";
import { FeedSettingsButton } from "@/components/onboarding/FeedSettingsButton";
import { usePreferences } from "@/components/onboarding/PreferencesProvider";
import { cardGradient } from "@/lib/feed/card-color";
import type { FeedPrefs } from "@/lib/feed/preferences";

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

function buildAllowedTypes(prefs: FeedPrefs): Set<SignalType> {
  const allowed = new Set<SignalType>();
  if (prefs.meme) allowed.add("meme");
  if (prefs.prediction) {
    allowed.add("prediction");
    allowed.add("multiprediction");
  }
  if (prefs.whale) allowed.add("whale");
  return allowed;
}

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
  const [flipNonce, setFlipNonce] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const slideCountRef = useRef(0);
  const prevIdxRef = useRef(0);
  // Prefs come from PreferencesProvider — single fetch for the
  // whole app. Modal saves update the same context state, so the
  // feed re-filters instantly without a refetch.
  const { prefs } = usePreferences();
  const visibleSignals = useMemo(() => {
    const allowed = buildAllowedTypes(prefs);
    if (allowed.size === 4) return signals; // all rails on — skip filter
    return signals.filter((s) => allowed.has(s.type));
  }, [signals, prefs]);

  // Stable refs so the fetcher closure always sees the latest values
  // without having to retrigger the IntersectionObserver effect.
  const stateRef = useRef({ signals, seed, cursor, total, loading: false });
  stateRef.current.signals = signals;
  stateRef.current.seed = seed;
  stateRef.current.cursor = cursor;
  stateRef.current.total = total;

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

      // Allow repeats — once the pool exhausts, reshuffles bring the same
      // items back in a different M-M-N arrangement. That's the infinite.
      setSignals((prev) => [...prev, ...data.signals]);
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
  }, [visibleSignals.length, loadMore]);

  // Bot-icon coin-flip cadence: count actual slide changes (not the
  // initial mount) and fire a flip on every 3rd slide. Acts as a subtle
  // tap-me hint — quick enough to land soon, sparse enough not to nag.
  useEffect(() => {
    if (activeIdx === prevIdxRef.current) return;
    prevIdxRef.current = activeIdx;
    slideCountRef.current += 1;
    if (slideCountRef.current % 3 === 0) {
      setFlipNonce((n) => n + 1);
    }
  }, [activeIdx]);

  const activeGradient = useMemo(
    () => cardGradient(visibleSignals[activeIdx]),
    [visibleSignals, activeIdx],
  );

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: activeGradient,
        transition: "background 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <BalancePill />
      <FeedSettingsButton />
      <div
        className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-scroll"
        style={{ scrollSnapStop: "always" }}
      >
        {visibleSignals.map((signal, i) => (
          <div
            key={`${i}-${signal.id}`}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            data-idx={i}
            className="h-full w-full snap-start"
          >
            <CardContent
              signal={signal}
              active={i === activeIdx}
              flipNonce={i === activeIdx ? flipNonce : 0}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardContent({
  signal,
  active,
  flipNonce,
}: {
  signal: Signal;
  active: boolean;
  flipNonce: number;
}) {
  return (
    <div
      className="h-full w-full transition-[transform,opacity] duration-500 ease-out will-change-transform"
      style={{
        transform: active ? "translateY(0) scale(1)" : "translateY(8px) scale(0.985)",
        opacity: active ? 1 : 0.55,
      }}
    >
      {signal.type === "meme" && <MemeCard signal={signal} flipNonce={flipNonce} />}
      {signal.type === "prediction" && <PredictionCard signal={signal} flipNonce={flipNonce} />}
      {signal.type === "multiprediction" && (
        <MultiPredictionCard signal={signal} flipNonce={flipNonce} />
      )}
      {signal.type === "whale" && <WhaleCard signal={signal} flipNonce={flipNonce} />}
    </div>
  );
}
