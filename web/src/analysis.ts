import type { ModalAnalysisResult, ModalBranchRecord } from "./types";

export const MAX_SWEEP_POINTS = 101;

export interface SweepSample {
  analysis: ModalAnalysisResult;
  value: number;
  values?: Record<string, number>;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  key: string;
  label: string;
  points: ChartPoint[];
}

function parseSweepNumber(text: string, label: string): string | number {
  if (text.trim() === "") {
    return `Enter sweep ${label}.`;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return `Sweep ${label} must be a finite number.`;
  }
  return value;
}

export function buildSweepValues(
  minText: string,
  maxText: string,
  stepText: string,
  maxPoints = MAX_SWEEP_POINTS,
): { error: string | null; values: number[] } {
  const parsedMin = parseSweepNumber(minText, "min");
  if (typeof parsedMin === "string") {
    return { error: parsedMin, values: [] };
  }
  const parsedMax = parseSweepNumber(maxText, "max");
  if (typeof parsedMax === "string") {
    return { error: parsedMax, values: [] };
  }
  const parsedStep = parseSweepNumber(stepText, "step");
  if (typeof parsedStep === "string") {
    return { error: parsedStep, values: [] };
  }
  if (parsedStep <= 0) {
    return { error: "Sweep step must be positive.", values: [] };
  }
  if (parsedMax < parsedMin) {
    return { error: "Sweep max must be greater than or equal to min.", values: [] };
  }
  if (parsedMax === parsedMin) {
    return { error: null, values: [parsedMin] };
  }

  const tolerance =
    Math.max(Math.abs(parsedMax - parsedMin), Math.abs(parsedStep), Number.MIN_VALUE) *
    1e-9;
  const values: number[] = [];
  for (
    let value = parsedMin;
    value <= parsedMax + tolerance;
    value = parsedMin + parsedStep * values.length
  ) {
    values.push(roundSweepValue(Math.min(value, parsedMax)));
    if (values.length > maxPoints) {
      return {
        error: `Sweep is limited to ${maxPoints} points. Increase the step or narrow the range.`,
        values: [],
      };
    }
  }
  const last = values[values.length - 1];
  if (Math.abs(last - parsedMax) > tolerance) {
    values.push(roundSweepValue(parsedMax));
  }
  if (values.length > maxPoints) {
    return {
      error: `Sweep is limited to ${maxPoints} points. Increase the step or narrow the range.`,
      values: [],
    };
  }
  return { error: null, values };
}

function roundSweepValue(value: number): number {
  return Number(value.toPrecision(15));
}

export function buildCurrentFrequencySeries(
  analysis: ModalAnalysisResult | null,
): ChartSeries[] {
  const frequencies = analysis?.frequencies_ghz ?? [];
  if (frequencies.length === 0) {
    return [];
  }
  return [
    {
      key: "frequency",
      label: "frequency GHz",
      points: frequencies.map((frequency, index) => ({ x: index, y: frequency })),
    },
  ];
}

export function buildCurrentZpfSeries(
  analysis: ModalAnalysisResult | null,
): ChartSeries[] {
  return (analysis?.branches ?? []).map((branch, index) => ({
    key: zpfTraceKey(branch, index),
    label: branchTraceLabel(branch, index),
    points: branch.phase_zpf.map((zpf, modeIndex) => ({ x: modeIndex, y: zpf })),
  }));
}

export function buildSweepFrequencySeries(samples: SweepSample[]): ChartSeries[] {
  const modeCount = maxFrequencyCount(samples);
  return Array.from({ length: modeCount }, (_, modeIndex) => ({
    key: `frequency_mode_${modeIndex}`,
    label: `mode ${modeIndex}`,
    points: samples
      .filter((sample) => sample.analysis.frequencies_ghz?.[modeIndex] !== undefined)
      .map((sample) => ({
        x: sample.value,
        y: sample.analysis.frequencies_ghz![modeIndex],
      })),
  }));
}

export function buildSweepZpfSeries(
  samples: SweepSample[],
  modeIndex: number,
): ChartSeries[] {
  const branches = referenceBranches(samples);
  return branches.map((branch, branchIndex) => ({
    key: zpfTraceKey(branch, branchIndex),
    label: branchTraceLabel(branch, branchIndex),
    points: samples
      .filter((sample) => sample.analysis.branches?.[branchIndex]?.phase_zpf[modeIndex] !== undefined)
      .map((sample) => ({
        x: sample.value,
        y: sample.analysis.branches![branchIndex].phase_zpf[modeIndex],
      })),
  }));
}

export function buildSweepPrecomputeQueue(
  values: Record<string, number>[],
  selectedValues: Record<string, number>,
  parameters: string[],
  cachedValues: Record<string, number>[],
  maxPoints = values.length,
): Record<string, number>[] {
  if (values.length === 0 || parameters.length === 0 || maxPoints <= 0) {
    return [];
  }

  const cachedKeys = new Set(
    cachedValues.map((value) => sweepPointKey(value, parameters)),
  );
  const indexMaps = sweepValueIndexMaps(values, parameters);
  return values
    .map((value, index) => ({
      distance: sweepPointDistance(value, selectedValues, parameters, indexMaps),
      index,
      key: sweepPointKey(value, parameters),
      value,
    }))
    .filter((entry) => !cachedKeys.has(entry.key))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, maxPoints)
    .map((entry) => entry.value);
}

function maxFrequencyCount(samples: SweepSample[]): number {
  return Math.max(
    0,
    ...samples.map((sample) => sample.analysis.frequencies_ghz?.length ?? 0),
  );
}

function referenceBranches(samples: SweepSample[]): ModalBranchRecord[] {
  return samples.find((sample) => (sample.analysis.branches?.length ?? 0) > 0)
    ?.analysis.branches ?? [];
}

function zpfTraceKey(branch: ModalBranchRecord, index: number): string {
  return branch.edge_id === null ? `junction_${index}` : `edge_${branch.edge_id}`;
}

function branchTraceLabel(branch: ModalBranchRecord, index: number): string {
  const edgeLabel = branch.edge_id === null ? `junction ${index}` : `edge ${branch.edge_id}`;
  return `${edgeLabel} phase ${branch.phase_nodes[0] ?? "GND"} - ${
    branch.phase_nodes[1] ?? "GND"
  }`;
}

interface SweepValueIndex {
  indexes: Map<number, number>;
  values: number[];
}

function sweepValueIndexMaps(
  values: Record<string, number>[],
  parameters: string[],
): Record<string, SweepValueIndex> {
  return Object.fromEntries(
    parameters.map((parameter) => {
      const uniqueValues = Array.from(
        new Set(
          values
            .map((value) => value[parameter])
            .filter((value) => Number.isFinite(value)),
        ),
      ).sort((left, right) => left - right);
      return [
        parameter,
        {
          indexes: new Map(uniqueValues.map((value, index) => [value, index])),
          values: uniqueValues,
        },
      ];
    }),
  );
}

function sweepPointDistance(
  value: Record<string, number>,
  selectedValues: Record<string, number>,
  parameters: string[],
  indexMaps: Record<string, SweepValueIndex>,
): number {
  return parameters.reduce((distance, parameter) => {
    const parameterIndexes = indexMaps[parameter];
    if (!parameterIndexes) {
      return distance;
    }
    const valueIndex = parameterIndexes.indexes.get(value[parameter]) ?? 0;
    const selectedValue = selectedValues[parameter];
    const selectedIndex =
      selectedValue === undefined
        ? 0
        : parameterIndexes.indexes.get(selectedValue) ??
          nearestValueIndex(parameterIndexes.values, selectedValue);
    return distance + Math.abs(valueIndex - selectedIndex);
  }, 0);
}

function nearestValueIndex(values: number[], selectedValue: number): number {
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

function sweepPointKey(
  value: Record<string, number>,
  parameters: string[],
): string {
  return JSON.stringify(parameters.map((parameter) => [parameter, value[parameter]]));
}
