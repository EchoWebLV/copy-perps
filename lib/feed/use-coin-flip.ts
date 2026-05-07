import { useEffect, useRef } from "react";

// Returns a ref to attach to the AI-bot button on each feed card. Each
// time `flipNonce` changes (and is non-zero), it toggles the
// `.coin-flip` class on for the duration of the keyframe animation, so
// the icon does a single 360° spin. FeedContainer drives the cadence.
export function useCoinFlip(flipNonce: number) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!flipNonce) return;
    const el = ref.current;
    if (!el) return;
    el.classList.add("coin-flip");
    const t = setTimeout(() => el.classList.remove("coin-flip"), 850);
    return () => {
      clearTimeout(t);
      el.classList.remove("coin-flip");
    };
  }, [flipNonce]);
  return ref;
}
