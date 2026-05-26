import {
  buildSweepValues,
  type SweepSample,
  type SweepScale,
} from "./analysis";
import type { ParameterInputMode, ParameterInputSpec } from "./parameterUnits";
import type { CircuitProject } from "./types";
import { serializeProjectForDirtyCheck } from "./projectState";

const MAX_SWEEP_CACHE_ENTRIES = 160;
const SWEEP_PRECOMPUTE_IDLE_TIMEOUT_MS = 450;

export interface ParameterSweepConfig {
  enabled: boolean;
  max: string;
  min: string;
  scale: SweepScale;
  step: string;
}

export type ParameterSweepConfigs = Record<string, ParameterSweepConfig>;

export interface MultiSweepValidation {
  error: string | null;
  parameterValues: Record<string, number[]>;
  precomputeLimit: number;
  parameters: string[];
  totalCombinations: number;
}

export const INITIAL_PARAMETER_SWEEP_CONFIG: ParameterSweepConfig = {
  enabled: false,
  max: "",
  min: "",
  scale: "linear",
  step: "",
};

export function missingParameterNames(
  parameters: string[],
  values: Record<string, string>,
): string[] {
  return parameters.filter((name) => (values[name] ?? "").trim() === "");
}

export function buildMultiSweepValues(
  parameters: string[],
  configs: ParameterSweepConfigs,
  maxPoints: number,
  inputModes: Record<string, ParameterInputMode> = {},
  inputSpecs: Record<string, ParameterInputSpec> = {},
): MultiSweepValidation {
  const activeParameters = parameters.filter((name) => configs[name]?.enabled);
  const parameterValues: Record<string, number[]> = {};
  let totalCombinations = activeParameters.length === 0 ? 0 : 1;

  for (const parameter of activeParameters) {
    const config = configs[parameter] ?? INITIAL_PARAMETER_SWEEP_CONFIG;
    const validation = buildSweepValues(
      config.min,
      config.max,
      config.step,
      maxPoints,
      config.scale ?? "linear",
    );
    if (validation.error) {
      return {
        error: `${parameter}: ${validation.error}`,
        parameterValues,
        precomputeLimit: 0,
        parameters: activeParameters,
        totalCombinations: 0,
      };
    }
    const spec = inputSpecs[parameter];
    if (
      inputModes[parameter] === "energy" &&
      spec?.kind &&
      validation.values.some((value) => value <= 0)
    ) {
      return {
        error: `${parameter}: ${spec.energyLabel}/h sweep values must be positive.`,
        parameterValues,
        precomputeLimit: 0,
        parameters: activeParameters,
        totalCombinations: 0,
      };
    }
    parameterValues[parameter] = validation.values;
    totalCombinations *= validation.values.length;
  }

  return {
    error: null,
    parameterValues,
    precomputeLimit: Math.min(maxPoints, totalCombinations),
    parameters: activeParameters,
    totalCombinations,
  };
}

export function selectedSampleForSweepValues(
  samples: SweepSample[],
  selectedValues: Record<string, number>,
): SweepSample | null {
  if (samples.length === 0) {
    return null;
  }
  const selectedNames = Object.keys(selectedValues);
  if (selectedNames.length === 0) {
    return null;
  }
  return (
    samples.find((sample) =>
      selectedNames.every((name) => sample.values?.[name] === selectedValues[name]),
    ) ?? null
  );
}

export function countSweepGridSamples(
  parameterValues: Record<string, number[]>,
  samples: SweepSample[],
  parameters: string[],
): number {
  if (samples.length === 0 || parameters.length === 0) {
    return 0;
  }
  return samples.filter((sample) =>
    parameters.every((parameter) =>
      (parameterValues[parameter] ?? []).includes(sample.values?.[parameter] ?? NaN),
    ),
  ).length;
}

export function selectedValuesForSweep(
  parameters: string[],
  parameterValues: Record<string, number[]>,
  currentValues: Record<string, number>,
): Record<string, number> {
  const selected: Record<string, number> = {};
  for (const parameter of parameters) {
    const values = parameterValues[parameter] ?? [];
    if (values.length === 0) {
      continue;
    }
    const currentValue = currentValues[parameter];
    const lowerBound = Math.min(values[0], values[values.length - 1]);
    const upperBound = Math.max(values[0], values[values.length - 1]);
    selected[parameter] =
      currentValue !== undefined &&
      Number.isFinite(currentValue) &&
      currentValue >= lowerBound &&
      currentValue <= upperBound
        ? currentValue
        : values[0];
  }
  return selected;
}

export function selectedSweepGridPoint(
  selectedValues: Record<string, number>,
  parameters: string[],
): Record<string, number> | null {
  if (
    parameters.length === 0 ||
    parameters.some(
      (parameter) =>
        selectedValues[parameter] === undefined ||
        !Number.isFinite(selectedValues[parameter]),
    )
  ) {
    return null;
  }
  return parameters.reduce<Record<string, number>>((point, parameter) => {
    point[parameter] = selectedValues[parameter] as number;
    return point;
  }, {});
}

export function nearestSweepValueIndex(
  values: number[],
  selectedValue: number,
): number {
  if (values.length === 0) {
    return 0;
  }
  let nearestIndex = 0;
  let nearestDistance = Math.abs(values[0] - selectedValue);
  for (let index = 1; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - selectedValue);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

export function sweepAnalysisParameterValues(
  fixedValues: Record<string, string>,
  selectedValues: Record<string, number>,
): Record<string, string> {
  return {
    ...fixedValues,
    ...Object.fromEntries(
      Object.entries(selectedValues).map(([name, value]) => [name, String(value)]),
    ),
  };
}

export function numericRecordEquals(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

export function sweepCacheKey(
  project: CircuitProject,
  parameterValues: Record<string, string>,
): string {
  const sortedValues = Object.entries(parameterValues).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify({
    parameterValues: sortedValues,
    project: serializeProjectForDirtyCheck(project),
  });
}

export function rememberSweepSample(
  cache: Map<string, SweepSample>,
  key: string,
  sample: SweepSample,
) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, sample);
  while (cache.size > MAX_SWEEP_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}

export function upsertSweepSample(
  samples: SweepSample[],
  sample: SweepSample,
): SweepSample[] {
  const sampleValues = sample.values ?? {};
  const next = samples.filter((existing) => {
    const existingValues = existing.values ?? {};
    const keys = new Set([
      ...Object.keys(existingValues),
      ...Object.keys(sampleValues),
    ]);
    return !Array.from(keys).every(
      (key) => existingValues[key] === sampleValues[key],
    );
  });
  return [...next, sample];
}

export function scheduleIdleWork(callback: () => void): () => void {
  const windowWithIdle = window as Window & {
    cancelIdleCallback?: (handle: number) => void;
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };
  if (typeof windowWithIdle.requestIdleCallback === "function") {
    const handle = windowWithIdle.requestIdleCallback(callback, {
      timeout: SWEEP_PRECOMPUTE_IDLE_TIMEOUT_MS,
    });
    return () => windowWithIdle.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, SWEEP_PRECOMPUTE_IDLE_TIMEOUT_MS);
  return () => window.clearTimeout(handle);
}
