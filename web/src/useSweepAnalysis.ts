import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  buildSweepPrecomputeQueueFromParameters,
  canStartSweepPrecompute,
  MAX_SWEEP_POINTS,
  type SweepSample,
} from "./analysis";
import {
  convertAnalysisParameterValues,
  type ParameterInputMode,
  type ParameterInputSpec,
} from "./parameterUnits";
import type { PyodideBridgeClient } from "./pyodideClient";
import {
  INITIAL_PARAMETER_SWEEP_CONFIG,
  buildMultiSweepValues,
  countSweepGridSamples,
  missingParameterNames,
  numericRecordEquals,
  rememberSweepSample,
  scheduleIdleWork,
  selectedSampleForSweepValues,
  selectedSweepGridPoint,
  selectedValuesForSweep,
  sweepAnalysisParameterValues,
  sweepCacheKey,
  upsertSweepSample,
  type ParameterSweepConfig,
  type ParameterSweepConfigs,
} from "./sweepState";
import type { CircuitProject, OutputResult } from "./types";
import type { EngineWarmupState } from "./useEngineWarmup";

const SWEEP_ANALYSIS_DEBOUNCE_MS = 120;
const SWEEP_INTERACTION_IDLE_MS = 350;

interface UseSweepAnalysisOptions {
  clientRef: { current: PyodideBridgeClient | null };
  output: OutputResult | null;
  outputParameters: string[];
  parameterInputModes: Record<string, ParameterInputMode>;
  parameterInputSpecs: Record<string, ParameterInputSpec>;
  parameterValues: Record<string, string>;
  projectRef: { current: CircuitProject };
  setEngineStatus: Dispatch<SetStateAction<string>>;
  setEngineWarmup: Dispatch<SetStateAction<EngineWarmupState>>;
}

export function useSweepAnalysis({
  clientRef,
  output,
  outputParameters,
  parameterInputModes,
  parameterInputSpecs,
  parameterValues,
  projectRef,
  setEngineStatus,
  setEngineWarmup,
}: UseSweepAnalysisOptions) {
  const [sweepConfig, setSweepConfig] = useState<ParameterSweepConfigs>({});
  const [sweepSamples, setSweepSamples] = useState<SweepSample[]>([]);
  const [sweepSliderValues, setSweepSliderValues] = useState<Record<string, number>>(
    {},
  );
  const [sweepInteractionActive, setSweepInteractionActive] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepPrecomputeRunning, setSweepPrecomputeRunning] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const sweepSampleCacheRef = useRef<Map<string, SweepSample>>(new Map());
  const sweepPrecomputeContextRef = useRef(0);
  const sweepPrecomputeJobIdRef = useRef(0);
  const sweepInteractionIdleTimerRef = useRef<number | null>(null);
  const sweepRequestIdRef = useRef(0);

  const clearSweepResults = useCallback(() => {
    sweepRequestIdRef.current += 1;
    sweepPrecomputeContextRef.current += 1;
    sweepPrecomputeJobIdRef.current += 1;
    if (sweepInteractionIdleTimerRef.current !== null) {
      window.clearTimeout(sweepInteractionIdleTimerRef.current);
      sweepInteractionIdleTimerRef.current = null;
    }
    setSweepSamples([]);
    setSweepSliderValues({});
    setSweepInteractionActive(false);
    setSweepRunning(false);
    setSweepPrecomputeRunning(false);
    setSweepError(null);
  }, []);

  const markSweepSliderInteraction = useCallback(() => {
    sweepPrecomputeContextRef.current += 1;
    sweepPrecomputeJobIdRef.current += 1;
    setSweepPrecomputeRunning(false);
    setSweepInteractionActive(true);
    if (sweepInteractionIdleTimerRef.current !== null) {
      window.clearTimeout(sweepInteractionIdleTimerRef.current);
    }
    sweepInteractionIdleTimerRef.current = window.setTimeout(() => {
      sweepInteractionIdleTimerRef.current = null;
      setSweepInteractionActive(false);
    }, SWEEP_INTERACTION_IDLE_MS);
  }, []);

  const updateSweepConfig = useCallback(
    (name: string, updates: Partial<ParameterSweepConfig>) => {
      setSweepConfig((current) => ({
        ...current,
        [name]: {
          ...(current[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG),
          ...updates,
        },
      }));
      clearSweepResults();
    },
    [clearSweepResults],
  );

  const resetSweepConfigForParameter = useCallback(
    (name: string) => {
      setSweepConfig((current) => ({
        ...current,
        [name]: INITIAL_PARAMETER_SWEEP_CONFIG,
      }));
      clearSweepResults();
    },
    [clearSweepResults],
  );

  const setSweepSliderValue = useCallback((name: string, value: number) => {
    setSweepSliderValues((current) =>
      current[name] === value ? current : { ...current, [name]: value },
    );
  }, []);

  const sweepValidation = useMemo(
    () =>
      buildMultiSweepValues(
        outputParameters,
        sweepConfig,
        MAX_SWEEP_POINTS,
        parameterInputModes,
        parameterInputSpecs,
      ),
    [outputParameters, parameterInputModes, parameterInputSpecs, sweepConfig],
  );
  const activeSweepParameters = sweepValidation.parameters;
  const selectedSweepValues = useMemo(
    () =>
      selectedValuesForSweep(
        activeSweepParameters,
        sweepValidation.parameterValues,
        sweepSliderValues,
      ),
    [activeSweepParameters, sweepSliderValues, sweepValidation.parameterValues],
  );
  const missingSweepFixedValues = useMemo(
    () =>
      outputParameters.filter(
        (name) =>
          !sweepConfig[name]?.enabled &&
          (parameterValues[name] ?? "").trim() === "",
      ),
    [outputParameters, parameterValues, sweepConfig],
  );
  const selectedSweepSample = useMemo(
    () => selectedSampleForSweepValues(sweepSamples, selectedSweepValues),
    [selectedSweepValues, sweepSamples],
  );
  const cachedSweepGridPointCount = useMemo(
    () =>
      countSweepGridSamples(
        sweepValidation.parameterValues,
        sweepSamples,
        activeSweepParameters,
      ),
    [activeSweepParameters, sweepSamples, sweepValidation.parameterValues],
  );
  const sweepModeActive =
    activeSweepParameters.length > 0 &&
    !sweepValidation.error &&
    sweepValidation.totalCombinations > 0;
  const activeParameterInputValues = useMemo(() => {
    const selectedGridPoint = selectedSweepGridPoint(
      selectedSweepValues,
      activeSweepParameters,
    );
    return activeSweepParameters.length > 0 && selectedGridPoint
      ? sweepAnalysisParameterValues(parameterValues, selectedGridPoint)
      : parameterValues;
  }, [activeSweepParameters, parameterValues, selectedSweepValues]);

  useEffect(
    () => () => {
      if (sweepInteractionIdleTimerRef.current !== null) {
        window.clearTimeout(sweepInteractionIdleTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!output) {
      clearSweepResults();
      return;
    }
    setSweepConfig((current) => {
      const next: ParameterSweepConfigs = {};
      for (const name of outputParameters) {
        next[name] = current[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG;
      }
      return next;
    });
  }, [clearSweepResults, output, outputParameters]);

  useEffect(() => {
    setSweepSliderValues((current) => {
      const next = selectedValuesForSweep(
        activeSweepParameters,
        sweepValidation.parameterValues,
        current,
      );
      return numericRecordEquals(current, next) ? current : next;
    });
  }, [activeSweepParameters, sweepValidation.parameterValues]);

  useEffect(() => {
    if (
      !output ||
      activeSweepParameters.length === 0 ||
      sweepValidation.error ||
      sweepValidation.totalCombinations === 0 ||
      missingSweepFixedValues.length > 0
    ) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      return;
    }

    const selectedGridPoint = selectedSweepGridPoint(
      selectedSweepValues,
      activeSweepParameters,
    );
    if (!selectedGridPoint) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      return;
    }

    const analysisParameterValues = sweepAnalysisParameterValues(
      parameterValues,
      selectedGridPoint,
    );
    const missing = missingParameterNames(output.parameters, analysisParameterValues);
    if (missing.length > 0) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      return;
    }
    const convertedParameterValues = convertAnalysisParameterValues(
      output.parameters,
      analysisParameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (convertedParameterValues.error) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      setSweepError(convertedParameterValues.error);
      return;
    }

    const sweepProject = projectRef.current;
    const cacheKey = sweepCacheKey(sweepProject, convertedParameterValues.values);
    const cachedSample = sweepSampleCacheRef.current.get(cacheKey);
    if (cachedSample) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      setSweepError(null);
      setSweepSamples((current) =>
        selectedSampleForSweepValues(current, selectedGridPoint)
          ? current
          : upsertSweepSample(current, cachedSample),
      );
      setEngineStatus("Loaded cached sweep point.");
      return;
    }

    const requestId = sweepRequestIdRef.current + 1;
    sweepRequestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      if (requestId !== sweepRequestIdRef.current) {
        return;
      }
      setSweepRunning(true);
      setSweepError(null);
      setEngineWarmup((current) => ({
        base: "ready",
        analysis: current.analysis === "ready" ? "ready" : "warming",
        error: null,
      }));
      setEngineStatus("Calculating selected sweep point...");
      clientRef.current!
        .analyze(sweepProject, convertedParameterValues.values)
        .then((analysis) => {
          if (requestId !== sweepRequestIdRef.current) {
            return;
          }
          if (!analysis.available || analysis.error) {
            throw new Error(
              analysis.error ?? "BBQ modal analysis failed at the selected sweep point.",
            );
          }
          const sample = {
            analysis,
            value: selectedGridPoint[activeSweepParameters[0]],
            values: selectedGridPoint,
          };
          rememberSweepSample(sweepSampleCacheRef.current, cacheKey, sample);
          setSweepSamples((current) => upsertSweepSample(current, sample));
          setEngineWarmup({ base: "ready", analysis: "ready", error: null });
          setEngineStatus("Calculated selected sweep point.");
        })
        .catch((error) => {
          if (requestId !== sweepRequestIdRef.current) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          setSweepError(message);
          setEngineWarmup((current) => ({
            ...current,
            analysis: current.analysis === "ready" ? "ready" : "error",
            error: message,
          }));
          setEngineStatus(message);
        })
        .finally(() => {
          if (requestId === sweepRequestIdRef.current) {
            setSweepRunning(false);
          }
        });
    }, SWEEP_ANALYSIS_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeSweepParameters,
    clientRef,
    missingSweepFixedValues,
    output,
    parameterInputModes,
    parameterInputSpecs,
    parameterValues,
    projectRef,
    selectedSweepValues,
    setEngineStatus,
    setEngineWarmup,
    sweepValidation.error,
    sweepValidation.totalCombinations,
  ]);

  useEffect(() => {
    if (!canStartSweepPrecompute({
      activeParameterCount: activeSweepParameters.length,
      hasSelectedSample: Boolean(selectedSweepSample),
      hasValidationError: Boolean(sweepValidation.error),
      missingFixedValueCount: missingSweepFixedValues.length,
      outputAvailable: Boolean(output),
      precomputeRunning: sweepPrecomputeRunning,
      sliderInteracting: sweepInteractionActive,
      sweepError,
      sweepRunning,
      totalCombinations: sweepValidation.totalCombinations,
    })) {
      return;
    }
    if (!output) {
      return;
    }

    const queuedPoints = buildSweepPrecomputeQueueFromParameters(
      sweepValidation.parameterValues,
      selectedSweepValues,
      activeSweepParameters,
      sweepSamples.map((sample) => sample.values ?? {}),
      sweepValidation.precomputeLimit,
    );
    const nextPoint = queuedPoints[0];
    if (!nextPoint) {
      return;
    }

    const sweepProject = projectRef.current;
    const analysisParameterValues = sweepAnalysisParameterValues(
      parameterValues,
      nextPoint,
    );
    const missing = missingParameterNames(output.parameters, analysisParameterValues);
    if (missing.length > 0) {
      return;
    }
    const convertedParameterValues = convertAnalysisParameterValues(
      output.parameters,
      analysisParameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (convertedParameterValues.error) {
      return;
    }

    const cacheKey = sweepCacheKey(sweepProject, convertedParameterValues.values);
    const cachedSample = sweepSampleCacheRef.current.get(cacheKey);
    if (cachedSample) {
      setSweepSamples((current) => upsertSweepSample(current, cachedSample));
      return;
    }

    const contextId = sweepPrecomputeContextRef.current;
    const jobId = sweepPrecomputeJobIdRef.current + 1;
    sweepPrecomputeJobIdRef.current = jobId;
    const cancelIdleWork = scheduleIdleWork(() => {
      if (
        contextId !== sweepPrecomputeContextRef.current ||
        jobId !== sweepPrecomputeJobIdRef.current
      ) {
        return;
      }
      setSweepPrecomputeRunning(true);
      clientRef.current!
        .analyze(sweepProject, convertedParameterValues.values)
        .then((analysis) => {
          if (
            contextId !== sweepPrecomputeContextRef.current ||
            jobId !== sweepPrecomputeJobIdRef.current
          ) {
            return;
          }
          if (!analysis.available || analysis.error) {
            throw new Error(
              analysis.error ?? "BBQ modal analysis failed while precomputing sweep points.",
            );
          }
          const sample = {
            analysis,
            value: nextPoint[activeSweepParameters[0]],
            values: nextPoint,
          };
          rememberSweepSample(sweepSampleCacheRef.current, cacheKey, sample);
          setSweepSamples((current) => upsertSweepSample(current, sample));
          setEngineWarmup({ base: "ready", analysis: "ready", error: null });
        })
        .catch((error) => {
          if (
            contextId !== sweepPrecomputeContextRef.current ||
            jobId !== sweepPrecomputeJobIdRef.current
          ) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          setSweepError(`Background sweep precompute stopped: ${message}`);
        })
        .finally(() => {
          if (
            contextId === sweepPrecomputeContextRef.current &&
            jobId === sweepPrecomputeJobIdRef.current
          ) {
            setSweepPrecomputeRunning(false);
          }
        });
    });

    return cancelIdleWork;
  }, [
    activeSweepParameters,
    clientRef,
    missingSweepFixedValues,
    output,
    parameterInputModes,
    parameterInputSpecs,
    parameterValues,
    projectRef,
    selectedSweepSample,
    selectedSweepValues,
    setEngineWarmup,
    sweepError,
    sweepInteractionActive,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
    sweepValidation.error,
    sweepValidation.parameterValues,
    sweepValidation.precomputeLimit,
    sweepValidation.totalCombinations,
  ]);

  return {
    activeParameterInputValues,
    activeSweepParameters,
    cachedSweepGridPointCount,
    clearSweepResults,
    markSweepSliderInteraction,
    missingSweepFixedValues,
    resetSweepConfigForParameter,
    selectedSweepSample,
    selectedSweepValues,
    setSweepSliderValue,
    sweepConfig,
    sweepError,
    sweepModeActive,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
    sweepSliderValues,
    sweepValidation,
    updateSweepConfig,
  };
}
