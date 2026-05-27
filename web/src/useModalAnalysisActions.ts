import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

import { downloadCsv } from "./csvExport";
import {
  convertAnalysisParameterValues,
  convertParameterDisplayValue,
  type ParameterInputMode,
  type ParameterInputSpec,
} from "./parameterUnits";
import type { PyodideBridgeClient } from "./pyodideClient";
import { missingParameterNames } from "./sweepState";
import type {
  CircuitProject,
  ModalAnalysisResult,
  OutputResult,
} from "./types";
import type { EngineWarmupState } from "./useEngineWarmup";

export const COPY_MATRICES_STATUS =
  "Copied matrices to clipboard. Paste them into Python or a notebook.";

const MODAL_ANALYSIS_DEBOUNCE_MS = 250;

interface UseModalAnalysisActionsOptions {
  activeSweepParameterCount: number;
  analysisRequestIdRef: { current: number };
  clearSweepResults: () => void;
  clientRef: { current: PyodideBridgeClient | null };
  engineWarmup: EngineWarmupState;
  missingParameterValueCount: number;
  modalAnalysis: ModalAnalysisResult | null;
  output: OutputResult | null;
  outputParameters: string[];
  parameterInputError: string | null;
  parameterInputModes: Record<string, ParameterInputMode>;
  parameterInputSpecs: Record<string, ParameterInputSpec>;
  parameterValues: Record<string, string>;
  preserveOutputPanelScroll: () => void;
  project: CircuitProject;
  projectRef: { current: CircuitProject };
  resetSweepConfigForParameter: (name: string) => void;
  runGenerateOutput: () => Promise<OutputResult | null>;
  setAnalysisRunning: Dispatch<SetStateAction<boolean>>;
  setEngineStatus: Dispatch<SetStateAction<string>>;
  setEngineWarmup: Dispatch<SetStateAction<EngineWarmupState>>;
  setModalAnalysis: Dispatch<SetStateAction<ModalAnalysisResult | null>>;
  setOutputDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setParameterInputModes: Dispatch<
    SetStateAction<Record<string, ParameterInputMode>>
  >;
  setParameterValues: Dispatch<SetStateAction<Record<string, string>>>;
  setSnippetCopied: Dispatch<SetStateAction<boolean>>;
  setTutorialCopied: Dispatch<SetStateAction<boolean>>;
}

export function useModalAnalysisActions({
  activeSweepParameterCount,
  analysisRequestIdRef,
  clearSweepResults,
  clientRef,
  engineWarmup,
  missingParameterValueCount,
  modalAnalysis,
  output,
  outputParameters,
  parameterInputError,
  parameterInputModes,
  parameterInputSpecs,
  parameterValues,
  preserveOutputPanelScroll,
  project,
  projectRef,
  resetSweepConfigForParameter,
  runGenerateOutput,
  setAnalysisRunning,
  setEngineStatus,
  setEngineWarmup,
  setModalAnalysis,
  setOutputDrawerOpen,
  setParameterInputModes,
  setParameterValues,
  setSnippetCopied,
  setTutorialCopied,
}: UseModalAnalysisActionsOptions) {
  function updateParameterValue(name: string, value: string) {
    analysisRequestIdRef.current += 1;
    setAnalysisRunning(false);
    setParameterValues((current) => ({ ...current, [name]: value }));
    setModalAnalysis(null);
    clearSweepResults();
  }

  function updateParameterInputMode(name: string, mode: ParameterInputMode) {
    const spec = parameterInputSpecs[name];
    const nextMode = spec?.kind ? mode : "physical";
    const previousMode = parameterInputModes[name] ?? "physical";
    if (previousMode === nextMode) {
      return;
    }

    analysisRequestIdRef.current += 1;
    setAnalysisRunning(false);
    setParameterInputModes((current) => ({ ...current, [name]: nextMode }));
    setParameterValues((current) => ({
      ...current,
      [name]: convertParameterDisplayValue(
        current[name] ?? "",
        spec,
        previousMode,
        nextMode,
      ),
    }));
    resetSweepConfigForParameter(name);
    setModalAnalysis(null);
  }

  async function runModalAnalysis(
    options: { preserveScroll?: boolean } = {},
  ): Promise<ModalAnalysisResult | null> {
    setOutputDrawerOpen(true);
    if (options.preserveScroll) {
      preserveOutputPanelScroll();
    }
    const result = output ?? (await runGenerateOutput());
    if (!result) {
      return null;
    }
    const analysisProject = projectRef.current;
    const analysisParameterValues = { ...parameterValues };
    const missing = missingParameterNames(result.parameters, analysisParameterValues);
    if (missing.length > 0) {
      setEngineStatus(
        `Enter parameter values before analysis: ${missing.join(", ")}`,
      );
      return null;
    }
    const convertedParameterValues = convertAnalysisParameterValues(
      result.parameters,
      analysisParameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (convertedParameterValues.error) {
      setEngineStatus(convertedParameterValues.error);
      return null;
    }

    clearSweepResults();
    setEngineWarmup((current) => ({
      base: "ready",
      analysis: current.analysis === "ready" ? "ready" : "warming",
      error: null,
    }));
    setEngineStatus(
      engineWarmup.analysis === "ready"
        ? "Running BBQ modal analysis..."
        : "Analysis engine is warming; running when ready...",
    );
    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;
    setAnalysisRunning(true);
    try {
      const analysis = await clientRef.current!.analyze(
        analysisProject,
        convertedParameterValues.values,
      );
      if (requestId !== analysisRequestIdRef.current) {
        return null;
      }
      setEngineWarmup({ base: "ready", analysis: "ready", error: null });
      if (!analysis.available || analysis.error) {
        throw new Error(analysis.error ?? "BBQ modal analysis is unavailable.");
      }
      setModalAnalysis(analysis);
      const modeCount = analysis.frequencies_ghz?.length ?? 0;
      const zpfRowCount = analysis.branches?.length ?? 0;
      setEngineStatus(
        zpfRowCount > 0
          ? `Computed ${modeCount} mode(s) and ${zpfRowCount} JJ ZPF row(s).`
          : `Computed ${modeCount} mode frequency result(s).`,
      );
      return analysis;
    } catch (error) {
      if (requestId !== analysisRequestIdRef.current) {
        return null;
      }
      setModalAnalysis(null);
      setEngineWarmup((current) => ({
        ...current,
        analysis: current.analysis === "ready" ? "ready" : "error",
        error: error instanceof Error ? error.message : String(error),
      }));
      setEngineStatus(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      if (requestId === analysisRequestIdRef.current) {
        setAnalysisRunning(false);
      }
    }
  }

  async function copySnippet() {
    const result = output?.snippet ? output : await runGenerateOutput();
    if (!result?.snippet) {
      return;
    }
    await navigator.clipboard.writeText(result.snippet);
    setEngineStatus(COPY_MATRICES_STATUS);
    setSnippetCopied(true);
    setTutorialCopied(true);
  }

  async function exportAnalysisCsv() {
    setOutputDrawerOpen(true);
    const result = output ?? (await runGenerateOutput());
    if (!result) {
      return;
    }
    const analysis = modalAnalysis?.available
      ? modalAnalysis
      : await runModalAnalysis();
    if (!analysis?.available || analysis.error) {
      return;
    }
    const exportParameterValues = convertAnalysisParameterValues(
      result.parameters,
      parameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (exportParameterValues.error) {
      setEngineStatus(exportParameterValues.error);
      return;
    }

    setEngineStatus("Exporting analysis table CSV...");
    try {
      const exportResult = await clientRef.current!.exportAnalysisJson(
        project,
        exportParameterValues.values,
        analysis,
      );
      if (exportResult.error) {
        throw new Error(exportResult.error);
      }
      downloadCsv(
        "cqedraw-analysis-table.csv",
        exportResult.columns,
        exportResult.rows,
      );
      setEngineStatus("Exported analysis table CSV.");
    } catch (error) {
      setEngineStatus(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    if (
      !output ||
      outputParameters.length === 0 ||
      activeSweepParameterCount > 0 ||
      missingParameterValueCount > 0 ||
      parameterInputError
    ) {
      analysisRequestIdRef.current += 1;
      setAnalysisRunning(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void runModalAnalysis({ preserveScroll: true });
    }, MODAL_ANALYSIS_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeSweepParameterCount,
    missingParameterValueCount,
    output,
    outputParameters.length,
    parameterInputError,
    parameterValues,
  ]);

  return {
    copySnippet,
    exportAnalysisCsv,
    runModalAnalysis,
    updateParameterInputMode,
    updateParameterValue,
  };
}
