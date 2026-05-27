import { describe, expect, it } from "vitest";

import {
  edgeComponentKind,
  edgeEndpoints,
  edgeGeometry,
  edgeInteractionZone,
  edgeValueLabels,
  josephsonPhaseLabel,
  localEdgePoint,
  matrixNodeLabelMap,
} from "../edgeGeometry";
import { GROUND_NODE_ID, type CircuitEdge, type CircuitNode } from "../types";

const nodes: CircuitNode[] = [
  { identifier: 10, name: "N10", x: 0, y: 0 },
  { identifier: 11, name: "N11", x: 120, y: 0 },
];

function edge(overrides: Partial<CircuitEdge> = {}): CircuitEdge {
  return {
    capacitance_expr: null,
    capacitance_text: null,
    ground_offset_x: 0,
    ground_offset_y: 104,
    identifier: 7,
    inductance_expr: null,
    inductance_text: null,
    is_ground: false,
    josephson_inductance_expr: null,
    josephson_inductance_text: null,
    josephson_phase_sign: 1,
    l_inverse_expr: null,
    nodes: [10, 11],
    ...overrides,
  };
}

describe("edge geometry helpers", () => {
  it("resolves regular and ground endpoints from project nodes", () => {
    expect(edgeEndpoints(edge(), nodes)).toEqual({
      end: { x: 120, y: 0 },
      start: { x: 0, y: 0 },
    });
    expect(
      edgeEndpoints(
        edge({
          ground_offset_x: 24,
          ground_offset_y: -48,
          is_ground: true,
          nodes: [10, GROUND_NODE_ID],
        }),
        nodes,
      ),
    ).toEqual({
      end: { x: 24, y: -48 },
      start: { x: 0, y: 0 },
    });
    expect(edgeEndpoints(edge({ nodes: [10, 99] }), nodes)).toBeNull();
  });

  it("normalizes reversed edge geometry for stable symbol orientation", () => {
    expect(edgeGeometry({ x: 120, y: 0 }, { x: 0, y: 0 })).toMatchObject({
      angle: 0,
      center: { x: 60, y: 0 },
      dx: 120,
      length: 120,
    });

    expect(localEdgePoint(edgeGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }), {
      x: 0,
      y: -44,
    })).toEqual({ x: 50, y: -44 });
  });

  it("classifies component combinations and places value labels", () => {
    const parallelEdge = edge({
      capacitance_text: "C12",
      inductance_text: "L12",
      josephson_inductance_text: "Lj",
    });
    const componentKind = edgeComponentKind(parallelEdge);
    const labels = edgeValueLabels(
      parallelEdge,
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      componentKind,
    );

    expect(componentKind).toBe("parallel-lcj");
    expect(labels.map((label) => [label.testId, label.text])).toEqual([
      ["edge-value-cap-7", "C=C12"],
      ["edge-value-ind-7", "L=L12"],
      ["edge-value-jj-7", "LJ=Lj"],
    ]);
    expect(edgeInteractionZone(
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      componentKind,
      labels,
    )).toMatchObject({
      height: expect.any(Number),
      width: expect.any(Number),
    });
  });

  it("builds sorted matrix labels and Josephson phase labels", () => {
    const labels = matrixNodeLabelMap([
      { identifier: 11, name: "N11", x: 0, y: 0 },
      { identifier: 10, name: "N10", x: 0, y: 0 },
    ]);

    expect([...labels.entries()]).toEqual([
      [10, "0"],
      [11, "1"],
    ]);
    expect(josephsonPhaseLabel(edge({ josephson_phase_sign: -1 }), labels)).toBe(
      "Phase: 0 - 1",
    );
    expect(
      josephsonPhaseLabel(
        edge({
          is_ground: true,
          josephson_phase_sign: -1,
          nodes: [10, GROUND_NODE_ID],
        }),
        labels,
      ),
    ).toBe("Phase: GND - 0");
  });
});
