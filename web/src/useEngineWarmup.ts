import { useEffect, useRef, useState } from "react";

import { PyodideBridgeClient } from "./pyodideClient";

declare global {
  interface Window {
    __CQEDRAW_SKIP_ENGINE_WARMUP__?: boolean;
  }
}

type WarmupPhase = "idle" | "warming" | "ready" | "error";

export interface EngineWarmupState {
  base: WarmupPhase;
  analysis: WarmupPhase;
  error: string | null;
}

const INITIAL_ENGINE_WARMUP: EngineWarmupState = {
  base: "idle",
  analysis: "idle",
  error: null,
};

interface UseEngineWarmupOptions {
  autoPrewarm?: boolean;
}

function shouldAutoPrewarmEngine() {
  return (
    typeof window === "undefined" || !window.__CQEDRAW_SKIP_ENGINE_WARMUP__
  );
}

export function useEngineWarmup(options: UseEngineWarmupOptions = {}) {
  const clientRef = useRef<PyodideBridgeClient | null>(null);
  const [engineWarmup, setEngineWarmup] = useState<EngineWarmupState>(
    INITIAL_ENGINE_WARMUP,
  );
  const autoPrewarm = options.autoPrewarm ?? shouldAutoPrewarmEngine();

  useEffect(() => {
    const client = new PyodideBridgeClient();
    clientRef.current = client;
    let cancelled = false;
    let analysisWarmupTimer: number | null = null;

    if (!autoPrewarm) {
      setEngineWarmup(INITIAL_ENGINE_WARMUP);
      return () => {
        cancelled = true;
        clientRef.current = null;
        client.dispose();
      };
    }

    setEngineWarmup({ base: "warming", analysis: "idle", error: null });
    client
      .prewarmBase()
      .then(() => {
        if (cancelled) {
          return;
        }
        setEngineWarmup({ base: "ready", analysis: "warming", error: null });
        analysisWarmupTimer = window.setTimeout(() => {
          client
            .prewarmAnalysis()
            .then(() => {
              if (!cancelled) {
                setEngineWarmup({
                  base: "ready",
                  analysis: "ready",
                  error: null,
                });
              }
            })
            .catch((error) => {
              if (!cancelled) {
                setEngineWarmup({
                  base: "ready",
                  analysis: "error",
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            });
        }, 300);
      })
      .catch((error) => {
        if (!cancelled) {
          setEngineWarmup({
            base: "error",
            analysis: "idle",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
      if (analysisWarmupTimer !== null) {
        window.clearTimeout(analysisWarmupTimer);
      }
      clientRef.current = null;
      client.dispose();
    };
  }, [autoPrewarm]);

  return { clientRef, engineWarmup, setEngineWarmup };
}
