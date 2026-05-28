"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  parsePythPriceUpdate,
  type FlashLiveMark,
  type FlashLivePriceSymbol,
} from "./live-prices";

type FlashLiveMarks = Partial<Record<FlashLivePriceSymbol, FlashLiveMark>>;

interface FlashLivePriceContextValue {
  marks: FlashLiveMarks;
}

const FlashLivePriceContext = createContext<FlashLivePriceContextValue>({
  marks: {},
});

export function FlashLivePriceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [marks, setMarks] = useState<FlashLiveMarks>({});

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/flash/perp/prices/stream");

    source.onmessage = (event) => {
      const nextMarks = parsePythPriceUpdate(event.data);
      if (Object.keys(nextMarks).length === 0) return;
      setMarks((current) => ({ ...current, ...nextMarks }));
    };

    source.onerror = () => {
      // EventSource reconnects automatically. Keep the previous marks visible.
    };

    return () => {
      source.close();
    };
  }, []);

  const value = useMemo(() => ({ marks }), [marks]);
  return (
    <FlashLivePriceContext.Provider value={value}>
      {children}
    </FlashLivePriceContext.Provider>
  );
}

export function useFlashLiveMarks(): FlashLiveMarks {
  return useContext(FlashLivePriceContext).marks;
}
