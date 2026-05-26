import { useEffect, useRef, useState } from "react";

import { PyodideBridgeClient } from "./pyodideClient";

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

export function useEngineWarmup() {
  const clientRef = useRef<PyodideBridgeClient | null>(null);
  const [engineWarmup, setEngineWarmup] = useState<EngineWarmupState>(
    INITIAL_ENGINE_WARMUP,
  );

  useEffect(() => {
    const client = new PyodideBridgeClient();
    clientRef.current = client;
    let cancelled = false;
    let analysisWarmupTimer: number | null = null;

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
      client.dispose();
    };
  }, []);

  return { clientRef, engineWarmup, setEngineWarmup };
}
