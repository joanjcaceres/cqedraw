import {
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { PyodideBridgeClient } from "./pyodideClient";
import type {
  CircuitProject,
  ModalAnalysisResult,
  OutputResult,
} from "./types";
import type { EngineWarmupState } from "./useEngineWarmup";

interface UseOutputGenerationOptions {
  analysisRequestIdRef: { current: number };
  clearSweepResults: () => void;
  clientRef: { current: PyodideBridgeClient | null };
  engineWarmup: EngineWarmupState;
  project: CircuitProject;
  setAnalysisRunning: Dispatch<SetStateAction<boolean>>;
  setEngineStatus: Dispatch<SetStateAction<string>>;
  setEngineWarmup: Dispatch<SetStateAction<EngineWarmupState>>;
  setModalAnalysis: Dispatch<SetStateAction<ModalAnalysisResult | null>>;
  setOutput: Dispatch<SetStateAction<OutputResult | null>>;
  setOutputDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSnippetCopied: Dispatch<SetStateAction<boolean>>;
}

export function useOutputGeneration({
  analysisRequestIdRef,
  clearSweepResults,
  clientRef,
  engineWarmup,
  project,
  setAnalysisRunning,
  setEngineStatus,
  setEngineWarmup,
  setModalAnalysis,
  setOutput,
  setOutputDrawerOpen,
  setSnippetCopied,
}: UseOutputGenerationOptions) {
  const outputGenerationPromiseRef = useRef<Promise<OutputResult | null> | null>(
    null,
  );

  async function generateOutput() {
    await runGenerateOutput();
  }

  async function runGenerateOutput(): Promise<OutputResult | null> {
    if (outputGenerationPromiseRef.current) {
      return outputGenerationPromiseRef.current;
    }

    setOutputDrawerOpen(true);
    setEngineStatus(
      engineWarmup.base === "ready"
        ? "Generating matrices..."
        : "Python engine is warming; generating when ready...",
    );
    setSnippetCopied(false);
    analysisRequestIdRef.current += 1;
    setAnalysisRunning(false);
    setModalAnalysis(null);
    clearSweepResults();

    const generationPromise = (async () => {
      try {
        const result = await clientRef.current!.generate(project);
        setEngineWarmup((current) => ({
          ...current,
          base: "ready",
          error: current.base === "error" ? null : current.error,
        }));
        if (result.error) {
          throw new Error(result.error);
        }
        setOutput(result);
        setEngineStatus(`Generated ${result.size} x ${result.size} matrices.`);
        return result;
      } catch (error) {
        setEngineWarmup((current) => ({
          ...current,
          base: current.base === "ready" ? current.base : "error",
          error: error instanceof Error ? error.message : String(error),
        }));
        setEngineStatus(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        outputGenerationPromiseRef.current = null;
      }
    })();
    outputGenerationPromiseRef.current = generationPromise;
    return generationPromise;
  }

  return {
    generateOutput,
    runGenerateOutput,
  };
}
