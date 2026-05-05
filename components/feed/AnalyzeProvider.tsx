"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { Signal } from "@/lib/types";
import { AnalyzeModal } from "./AnalyzeModal";

interface Ctx {
  open: (signal: Signal) => void;
  close: () => void;
}

const AnalyzeContext = createContext<Ctx | null>(null);

export function AnalyzeProvider({ children }: { children: ReactNode }) {
  const [signal, setSignal] = useState<Signal | null>(null);

  const open = useCallback((s: Signal) => setSignal(s), []);
  const close = useCallback(() => setSignal(null), []);

  return (
    <AnalyzeContext.Provider value={{ open, close }}>
      {children}
      <AnalyzeModal signal={signal} onClose={close} />
    </AnalyzeContext.Provider>
  );
}

export function useAnalyze(): Ctx {
  const ctx = useContext(AnalyzeContext);
  if (!ctx) {
    // Outside provider — gracefully no-op so card icons don't crash if
    // someone forgets to wrap.
    return { open: () => {}, close: () => {} };
  }
  return ctx;
}
