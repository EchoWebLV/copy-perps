"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { Signal } from "@/lib/types";
import { AnalyzeModal } from "./AnalyzeModal";

interface Ctx {
  open: (signal: Signal) => void;
  close: () => void;
}

const AnalyzeContext = createContext<Ctx | null>(null);

export function AnalyzeProvider({ children }: { children: ReactNode }) {
  const [signal, setSignal] = useState<Signal | null>(null);
  const { authenticated, login } = usePrivy();

  // Gwak's analysis costs API tokens — gate behind login. Tapping the
  // icon while unauthenticated opens the Privy login modal instead.
  const open = useCallback(
    (s: Signal) => {
      if (!authenticated) {
        login();
        return;
      }
      setSignal(s);
    },
    [authenticated, login],
  );
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
