"use client";

// Persistent Bullish/Bearish community sentiment for any set of stable string
// ids — whales keyed by their whaleId, arena bots keyed by `bot:<persona>`.
// Reads counts + the caller's own vote from /api/whales/sentiment (the backend
// is id-generic, so the same endpoint serves whales and bots) and exposes
// react() to cast/toggle a vote with an optimistic update reconciled against
// the server response.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  EMPTY_SENTIMENT,
  type TraderSentiment,
  type WhaleVote,
} from "./DesktopWhaleCard";

const SENTIMENT_CHUNK = 150;

type SentimentApi = Record<
  string,
  { bullish: number; bearish: number; myReaction: WhaleVote | null }
>;

function toTraderSentiment(s: {
  bullish: number;
  bearish: number;
  myReaction: WhaleVote | null;
}): TraderSentiment {
  return {
    bullish: s.bullish,
    bearish: s.bearish,
    total: s.bullish + s.bearish,
    myReaction: s.myReaction,
  };
}

export function useSentiment(ids: string[]): {
  sentiment: Record<string, TraderSentiment>;
  react: (id: string, reaction: WhaleVote) => void;
} {
  const { authenticated, getAccessToken, login } = usePrivy();
  const idsKey = useMemo(
    () => [...new Set(ids)].filter(Boolean).sort().join(","),
    [ids],
  );
  const [sentiment, setSentiment] = useState<Record<string, TraderSentiment>>(
    {},
  );
  const sentimentRef = useRef(sentiment);
  sentimentRef.current = sentiment;
  const fetchedKeyRef = useRef("");

  useEffect(() => {
    if (!idsKey || fetchedKeyRef.current === idsKey) return;
    const capturedKey = idsKey;
    const list = capturedKey.split(",").filter(Boolean);
    if (list.length === 0) return;
    let cancelled = false;
    void (async () => {
      const token = authenticated
        ? await getAccessToken().catch(() => null)
        : null;
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};
      const chunks: string[][] = [];
      for (let i = 0; i < list.length; i += SENTIMENT_CHUNK) {
        chunks.push(list.slice(i, i + SENTIMENT_CHUNK));
      }
      const responses = await Promise.all(
        chunks.map((chunk) =>
          fetch(
            `/api/whales/sentiment?whaleIds=${chunk
              .map(encodeURIComponent)
              .join(",")}`,
            { cache: "no-store", headers },
          )
            .then((r) =>
              r.ok
                ? (r.json() as Promise<{ sentiment?: SentimentApi } | null>)
                : null,
            )
            .catch(() => null),
        ),
      );
      if (cancelled) return;
      const result: Record<string, TraderSentiment> = {};
      for (const data of responses) {
        if (!data?.sentiment) continue;
        for (const [id, s] of Object.entries(data.sentiment)) {
          result[id] = toTraderSentiment(s);
        }
      }
      fetchedKeyRef.current = capturedKey;
      setSentiment(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey, authenticated, getAccessToken]);

  const react = useCallback(
    (id: string, reaction: WhaleVote) => {
      if (!authenticated) {
        login();
        return;
      }
      const cur = sentimentRef.current[id] ?? EMPTY_SENTIMENT;
      const next: WhaleVote | null =
        cur.myReaction === reaction ? null : reaction;

      // Optimistic update.
      setSentiment((prev) => {
        const c = prev[id] ?? EMPTY_SENTIMENT;
        let bullish = c.bullish;
        let bearish = c.bearish;
        if (c.myReaction === "Bullish") bullish -= 1;
        else if (c.myReaction === "Bearish") bearish -= 1;
        if (next === "Bullish") bullish += 1;
        else if (next === "Bearish") bearish += 1;
        return {
          ...prev,
          [id]: { bullish, bearish, total: bullish + bearish, myReaction: next },
        };
      });

      void (async () => {
        try {
          const token = await getAccessToken();
          const r = await fetch("/api/whales/sentiment", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            // The route's id param is named whaleId, but it stores any string.
            body: JSON.stringify({ whaleId: id, reaction: next }),
          });
          if (!r.ok) return;
          const data = (await r.json()) as { sentiment?: SentimentApi };
          const s = data.sentiment?.[id];
          if (s) {
            setSentiment((prev) => ({ ...prev, [id]: toTraderSentiment(s) }));
          }
        } catch {
          // Optimistic state stays; the next fetch reconciles.
        }
      })();
    },
    [authenticated, getAccessToken, login],
  );

  return { sentiment, react };
}
