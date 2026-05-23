import { describe, expect, it } from "vitest";

import {
  buildCurrentFrequencySeries,
  buildCurrentZpfSeries,
  buildSweepFrequencySeries,
  buildSweepValues,
  buildSweepZpfSeries,
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
          { x: 0, y: 0.01 },
          { x: 1, y: -0.02 },
        ],
      },
    ]);
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
