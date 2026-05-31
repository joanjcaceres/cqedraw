import { describe, expect, it } from "vitest";

import {
  absoluteChartSeries,
  buildCurrentFrequencySeries,
  buildCurrentZpfSeries,
  buildSweepPrecomputeQueue,
  buildSweepPrecomputeQueueFromParameters,
  buildSweepFrequencySeries,
  buildSweepValues,
  buildSweepZpfSeries,
  canStartSweepPrecompute,
  chartBounds,
  referenceFrequencyYBounds,
  referenceZpfYBounds,
  type SweepSample,
} from "../analysis";

const jjBranch = {
  E_j_GHz: 20,
  L_j: 8e-9,
  edge_id: 7,
  inductance_expr: "Lj",
  matrix_nodes: [0, 1] as [number, number],
  phase_negative_index: 1,
  phase_nodes: [0, 1] as [number, number],
  phase_positive_index: 0,
  phase_sign: 1 as const,
  phase_zpf: [0.01, -0.02],
  project_nodes: [0, 1] as [number, number],
};

describe("analysis helpers", () => {
  it("builds sweep values including a non-aligned endpoint", () => {
    expect(buildSweepValues("0", "1", "0.3")).toEqual({
      error: null,
      values: [0, 0.3, 0.6, 0.9, 1],
    });
    expect(buildSweepValues("1e-15", "3e-15", "1e-15")).toEqual({
      error: null,
      values: [1e-15, 2e-15, 3e-15],
    });
  });

  it("builds logarithmic sweep values from points per decade", () => {
    expect(buildSweepValues("1e-15", "1e-13", "2", 101, "log")).toEqual({
      error: null,
      values: [
        1e-15,
        3.16227766016838e-15,
        1e-14,
        3.16227766016838e-14,
        1e-13,
      ],
    });
  });

  it("rejects invalid sweep ranges and overly dense sweeps", () => {
    expect(buildSweepValues("", "1", "0.1").error).toBe("Enter sweep min.");
    expect(buildSweepValues("2", "1", "0.1").error).toBe(
      "Sweep max must be greater than or equal to min.",
    );
    expect(buildSweepValues("0", "1", "0").error).toBe(
      "Sweep step must be positive.",
    );
    expect(buildSweepValues("0", "1", "0.001").error).toContain(
      "limited to 101 points",
    );
    expect(buildSweepValues("0", "1", "4", 101, "log").error).toBe(
      "Log sweep min and max must be positive.",
    );
    expect(buildSweepValues("1", "10", "0.5", 101, "log").error).toBe(
      "Log sweep points per decade must be at least 1.",
    );
  });

  it("orders background sweep work by distance from the selected point", () => {
    const values = [0, 1, 2, 3, 4].map((C) => ({ C }));

    expect(
      buildSweepPrecomputeQueue(values, { C: 2 }, ["C"], [{ C: 2 }]),
    ).toEqual([{ C: 1 }, { C: 3 }, { C: 0 }, { C: 4 }]);
    expect(
      buildSweepPrecomputeQueue(values, { C: 2.6 }, ["C"], [], 2),
    ).toEqual([{ C: 3 }, { C: 2 }]);
  });

  it("orders multi-parameter background sweep work near the selected grid point", () => {
    const values = [
      { C: 1, L: 10 },
      { C: 1, L: 20 },
      { C: 2, L: 10 },
      { C: 2, L: 20 },
    ];

    expect(
      buildSweepPrecomputeQueue(
        values,
        { C: 1, L: 10 },
        ["C", "L"],
        [{ C: 1, L: 10 }],
      ),
    ).toEqual([
      { C: 1, L: 20 },
      { C: 2, L: 10 },
      { C: 2, L: 20 },
    ]);
  });

  it("orders large multi-parameter background work without materializing the full grid", () => {
    const parameterValues = {
      C: [1, 2, 3, 4, 5],
      Cg: [10, 20, 30, 40, 50],
      L: [100, 200, 300, 400, 500],
    };

    expect(
      buildSweepPrecomputeQueueFromParameters(
        parameterValues,
        { C: 3, Cg: 30, L: 300 },
        ["C", "Cg", "L"],
        [{ C: 3, Cg: 30, L: 300 }],
        6,
      ),
    ).toEqual([
      { C: 2, Cg: 30, L: 300 },
      { C: 3, Cg: 20, L: 300 },
      { C: 3, Cg: 30, L: 200 },
      { C: 3, Cg: 30, L: 400 },
      { C: 3, Cg: 40, L: 300 },
      { C: 4, Cg: 30, L: 300 },
    ]);
  });

  it("builds current analysis chart series", () => {
    const analysis = {
      available: true,
      branches: [jjBranch],
      frequencies_ghz: [5, 7],
    };

    expect(buildCurrentFrequencySeries(analysis)).toEqual([
      {
        key: "frequency",
        label: "frequency GHz",
        points: [
          { x: 0, y: 5 },
          { x: 1, y: 7 },
        ],
      },
    ]);
    expect(buildCurrentZpfSeries(analysis)).toEqual([
      {
        key: "edge_7",
        label: "edge 7 phase 0 - 1",
        points: [
          {
            tooltipLines: [{ label: "frequency", unit: "GHz", value: 5 }],
            x: 0,
            y: 0.01,
          },
          {
            tooltipLines: [{ label: "frequency", unit: "GHz", value: 7 }],
            x: 1,
            y: -0.02,
          },
        ],
      },
    ]);
    expect(absoluteChartSeries(buildCurrentZpfSeries(analysis))).toEqual([
      {
        key: "edge_7",
        label: "edge 7 phase 0 - 1",
        points: [
          {
            tooltipLines: [{ label: "frequency", unit: "GHz", value: 5 }],
            x: 0,
            y: 0.01,
          },
          {
            tooltipLines: [{ label: "frequency", unit: "GHz", value: 7 }],
            x: 1,
            y: 0.02,
          },
        ],
      },
    ]);
  });

  it("computes bounds for large reference datasets without stack overflow", () => {
    const series = [
      {
        key: "current",
        label: "current",
        points: Array.from({ length: 100 }, (_, index) => ({
          x: index,
          y: index,
        })),
      },
    ];
    const yReferenceSeries = Array.from({ length: 3000 }, (_, seriesIndex) => ({
      key: `reference-${seriesIndex}`,
      label: `reference ${seriesIndex}`,
      points: Array.from({ length: 100 }, (_, pointIndex) => ({
        x: pointIndex,
        y: seriesIndex + pointIndex,
      })),
    }));

    expect(chartBounds(series, yReferenceSeries)).toMatchObject({
      maxX: 99,
      minX: 0,
    });
  });

  it("can include zero in chart y bounds for reference lines", () => {
    const positiveSeries = [
      {
        key: "frequency",
        label: "frequency",
        points: [
          { x: 0, y: 5 },
          { x: 1, y: 7 },
        ],
      },
    ];

    expect(chartBounds(positiveSeries, [], undefined, null, true).minY).toBeLessThan(
      0,
    );

    const manualBounds = chartBounds(
      positiveSeries,
      [],
      { maxY: 8, minY: 4 },
      null,
      true,
    );
    expect(manualBounds.minY).toBe(4);
  });

  it("computes cached frequency bounds without building reference series", () => {
    const results = Array.from({ length: 2000 }, (_, index) => ({
      available: true,
      branches: [],
      frequencies_ghz: [index, index + 0.5],
    }));

    expect(referenceFrequencyYBounds(results)).toEqual({
      maxY: 1999.5,
      minY: 0,
    });
  });

  it("computes cached phase ZPF bounds for selected traces only", () => {
    const branchA = { ...jjBranch, edge_id: 7, phase_zpf: [-10, 10] };
    const branchB = { ...jjBranch, edge_id: 8, phase_zpf: [-0.2, 0.4] };
    const results = [
      {
        available: true,
        branches: [branchA, branchB],
        frequencies_ghz: [5, 7],
      },
    ];

    expect(referenceZpfYBounds(results, ["edge_8"])).toEqual({
      maxY: 0.4,
      minY: -0.2,
    });
    expect(referenceZpfYBounds(results, ["edge_8"], true)).toEqual({
      maxY: 0.4,
      minY: 0.2,
    });
  });

  it("blocks background sweep precompute while sliders are active", () => {
    const readyState = {
      activeParameterCount: 1,
      hasSelectedSample: true,
      hasValidationError: false,
      missingFixedValueCount: 0,
      outputAvailable: true,
      precomputeRunning: false,
      sliderInteracting: false,
      sweepError: null,
      sweepRunning: false,
      totalCombinations: 5,
    };

    expect(canStartSweepPrecompute(readyState)).toBe(true);
    expect(
      canStartSweepPrecompute({ ...readyState, sliderInteracting: true }),
    ).toBe(false);
  });

  it("builds sweep chart series", () => {
    const samples: SweepSample[] = [
      {
        analysis: {
          available: true,
          branches: [jjBranch],
          frequencies_ghz: [5, 7],
        },
        value: 1,
      },
      {
        analysis: {
          available: true,
          branches: [{ ...jjBranch, phase_zpf: [0.03, -0.04] }],
          frequencies_ghz: [6, 8],
        },
        value: 2,
      },
    ];

    expect(buildSweepFrequencySeries(samples)).toEqual([
      {
        key: "frequency_mode_0",
        label: "mode 0",
        points: [
          { x: 1, y: 5 },
          { x: 2, y: 6 },
        ],
      },
      {
        key: "frequency_mode_1",
        label: "mode 1",
        points: [
          { x: 1, y: 7 },
          { x: 2, y: 8 },
        ],
      },
    ]);
    expect(buildSweepZpfSeries(samples, 1)).toEqual([
      {
        key: "edge_7",
        label: "edge 7 phase 0 - 1",
        points: [
          { x: 1, y: -0.02 },
          { x: 2, y: -0.04 },
        ],
      },
    ]);
  });
});
