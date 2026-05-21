import { describe, expect, it } from "vitest";

import {
  addEdge,
  addNode,
  analyzeConcatenateSelection,
  concatenateSelection,
  emptyProject,
  hasRegularEdge,
  mergeNodes,
  moveGroundEdge,
  normalizeProject,
  removeNode,
  toggleGround,
  updateEdgeValues,
} from "../graph";
import { GROUND_NODE_ID } from "../types";

describe("graph state", () => {
  it("creates nodes with stable ids and generated names", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);

    expect(project.state.node_counter).toBe(2);
    expect(project.state.nodes.map((node) => node.name)).toEqual(["N1", "N2"]);
    expect(project.state.nodes.map((node) => [node.x, node.y])).toEqual([
      [100, 120],
      [240, 120],
    ]);
  });

  it("adds regular and ground edges with desktop-compatible fields", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addEdge(project, 0, 1);
    project = toggleGround(project, 1);
    project = updateEdgeValues(project, 0, {
      capacitanceText: "C12",
      inductanceText: "L12",
    });

    expect(project.state.edge_counter).toBe(2);
    expect(project.state.edges[0]).toMatchObject({
      identifier: 0,
      nodes: [0, 1],
      capacitance_expr: "C12",
      capacitance_text: "C12",
      inductance_expr: "L12",
      inductance_text: "L12",
      is_ground: false,
    });
    expect(project.state.edges[1]).toMatchObject({
      identifier: 1,
      nodes: [1, GROUND_NODE_ID],
      is_ground: true,
    });
  });

  it("keeps a single regular edge between two nodes", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addEdge(project, 0, 1);
    project = addEdge(project, 1, 0);

    expect(project.state.edges).toHaveLength(1);
    expect(hasRegularEdge(project.state, 1, 0)).toBe(true);
    expect(project.state.edge_counter).toBe(1);
  });

  it("removes node-connected edges", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addNode(project, 380, 120);
    project = addEdge(project, 0, 1);
    project = addEdge(project, 1, 2);
    project = toggleGround(project, 2);
    project = removeNode(project, 1);

    expect(project.state.nodes.map((node) => node.identifier)).toEqual([0, 2]);
    expect(project.state.edges).toHaveLength(1);
    expect(project.state.edges[0].nodes).toEqual([2, GROUND_NODE_ID]);
  });

  it("moves only the selected ground edge endpoint", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addEdge(project, 0, 1);
    project = toggleGround(project, 1);
    project = updateEdgeValues(project, 1, {
      capacitanceText: "Cg",
      inductanceText: "1/Lg_inv",
    });

    const moved = moveGroundEdge(project, 1, 64, -32);

    expect(moved.state.nodes).toEqual(project.state.nodes);
    expect(moved.state.edges[0]).toEqual(project.state.edges[0]);
    expect(moved.state.edges[1]).toMatchObject({
      identifier: 1,
      nodes: [1, GROUND_NODE_ID],
      capacitance_text: "Cg",
      inductance_text: "1/Lg_inv",
      ground_offset_x: 64,
      ground_offset_y: -32,
      is_ground: true,
    });
  });

  it("concatenates selected chains and preserves edge values and grounds", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addEdge(project, 0, 1);
    project = updateEdgeValues(project, 0, {
      capacitanceText: "C12",
      inductanceText: "1/L12_inv",
    });
    project = toggleGround(project, 1);
    project = updateEdgeValues(project, 1, {
      capacitanceText: "Cg",
      inductanceText: "1/Lg_inv",
    });
    project = moveGroundEdge(project, 1, 32, -48);

    const result = concatenateSelection(project, [0, 1], 2);

    expect(result).not.toBeNull();
    const next = result!.project;
    expect(result!.nodeIds).toEqual([2, 3]);
    expect(next.state.nodes.map((node) => node.name)).toEqual([
      "N1",
      "N2",
      "N3",
      "N4",
    ]);
    expect(next.state.nodes.map((node) => [node.identifier, node.x, node.y])).toEqual([
      [0, 100, 120],
      [1, 240, 120],
      [2, 424, 120],
      [3, 608, 120],
    ]);
    expect(next.state.edges.map((edge) => edge.nodes)).toEqual([
      [0, 1],
      [1, GROUND_NODE_ID],
      [1, 2],
      [2, GROUND_NODE_ID],
      [2, 3],
      [3, GROUND_NODE_ID],
    ]);
    expect(next.state.edges.map((edge) => edge.capacitance_text)).toEqual([
      "C12",
      "Cg",
      "C12",
      "Cg",
      "C12",
      "Cg",
    ]);
    expect(next.state.edges[3]).toMatchObject({
      ground_offset_x: 32,
      ground_offset_y: -48,
      is_ground: true,
    });
    expect(next.state.selected_nodes).toEqual([2, 3]);
    expect(next.state.focus_node).toBe(3);
  });

  it("preserves left-boundary grounds on shared concatenate nodes", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addEdge(project, 0, 1);
    project = toggleGround(project, 0);
    project = updateEdgeValues(project, 1, { capacitanceText: "CgLeft" });

    const result = concatenateSelection(project, [0, 1], 1);

    expect(result).not.toBeNull();
    const next = result!.project;
    expect(next.state.edges.map((edge) => edge.nodes)).toEqual([
      [0, 1],
      [0, GROUND_NODE_ID],
      [1, 2],
      [1, GROUND_NODE_ID],
    ]);
    expect(next.state.edges[3]).toMatchObject({
      capacitance_text: "CgLeft",
      is_ground: true,
    });
  });

  it("concatenates multi-row boundary nodes by matching rows", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 112, 220);
    project = addNode(project, 260, 120);
    project = addNode(project, 252, 220);
    project = addEdge(project, 0, 2);
    project = updateEdgeValues(project, 0, { capacitanceText: "Ct" });
    project = addEdge(project, 1, 3);
    project = updateEdgeValues(project, 1, { capacitanceText: "Cb" });

    expect(analyzeConcatenateSelection(project, [0, 1, 2, 3])).toEqual({
      autoPortCount: 2,
      maxPortCount: 2,
    });

    const result = concatenateSelection(project, [0, 1, 2, 3], 1);

    expect(result).not.toBeNull();
    const next = result!.project;
    expect(result!.nodeIds).toEqual([4, 5]);
    expect(next.state.nodes.map((node) => [node.identifier, node.x, node.y])).toEqual([
      [0, 100, 120],
      [1, 112, 220],
      [2, 260, 120],
      [3, 252, 220],
      [4, 464, 120],
      [5, 456, 220],
    ]);
    expect(next.state.edges.map((edge) => edge.nodes)).toEqual([
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 5],
    ]);
    expect(next.state.edges.map((edge) => edge.capacitance_text)).toEqual([
      "Ct",
      "Cb",
      "Ct",
      "Cb",
    ]);
  });

  it("uses an explicit concatenate port count when automatic detection is too narrow", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 140, 220);
    project = addNode(project, 260, 220);
    project = addNode(project, 300, 120);
    project = addEdge(project, 0, 3);
    project = updateEdgeValues(project, 0, { capacitanceText: "Ct" });
    project = addEdge(project, 1, 2);
    project = updateEdgeValues(project, 1, { capacitanceText: "Cb" });

    expect(analyzeConcatenateSelection(project, [0, 1, 2, 3])).toEqual({
      autoPortCount: 1,
      maxPortCount: 2,
    });

    const result = concatenateSelection(project, [0, 1, 2, 3], 1, {
      portCount: 2,
    });

    expect(result).not.toBeNull();
    const next = result!.project;
    expect(result!.nodeIds).toEqual([4, 5]);
    expect(next.state.edges.map((edge) => edge.nodes)).toEqual([
      [0, 3],
      [1, 2],
      [3, 5],
      [2, 4],
    ]);
    expect(next.state.edges.map((edge) => edge.capacitance_text)).toEqual([
      "Ct",
      "Cb",
      "Ct",
      "Cb",
    ]);
  });

  it("duplicates zero-width selections instead of collapsing their boundary", () => {
    let project = emptyProject();
    project = addNode(project, 120, 100);
    project = addNode(project, 120, 220);
    project = addEdge(project, 0, 1);
    project = updateEdgeValues(project, 0, { capacitanceText: "Cv" });

    const result = concatenateSelection(project, [0, 1], 1);

    expect(result).not.toBeNull();
    const next = result!.project;
    expect(result!.nodeIds).toEqual([2, 3]);
    expect(next.state.nodes.map((node) => [node.identifier, node.x, node.y])).toEqual([
      [0, 120, 100],
      [1, 120, 220],
      [2, 230, 100],
      [3, 230, 220],
    ]);
    expect(next.state.edges.map((edge) => edge.nodes)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("merges selected nodes into a survivor and removes internal edges", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addNode(project, 380, 120);
    project = addEdge(project, 0, 1);
    project = addEdge(project, 1, 2);

    const result = mergeNodes(project, 0, [0, 1]);

    expect(result.summary).toMatchObject({
      mergedNodes: 1,
      rewiredEdges: 2,
      removedSelfLoops: 1,
    });
    expect(result.project.state.nodes.map((node) => node.identifier)).toEqual([0, 2]);
    expect(result.project.state.edges).toHaveLength(1);
    expect(result.project.state.edges[0]).toMatchObject({
      identifier: 1,
      nodes: [0, 2],
    });
    expect(result.project.state.selected_nodes).toEqual([0]);
    expect(result.project.state.focus_node).toBe(0);
  });

  it("combines ground edges when merged nodes both have ground connections", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = toggleGround(project, 0);
    project = updateEdgeValues(project, 0, {
      capacitanceText: "Cg1",
      inductanceText: "Lg1",
    });
    project = toggleGround(project, 1);
    project = updateEdgeValues(project, 1, {
      capacitanceText: "Cg2",
      inductanceText: "Lg2",
    });

    const result = mergeNodes(project, 0, [0, 1]);

    expect(result.summary.combinedGroundEdges).toBe(1);
    expect(result.project.state.nodes.map((node) => node.identifier)).toEqual([0]);
    expect(result.project.state.edges).toHaveLength(1);
    expect(result.project.state.edges[0]).toMatchObject({
      identifier: 0,
      nodes: [0, GROUND_NODE_ID],
      capacitance_text: "(Cg1) + (Cg2)",
      inductance_text: "1 / (1 / (Lg1) + 1 / (Lg2))",
      is_ground: true,
    });
  });

  it("combines regular edges that collapse onto the same pair after merge", () => {
    let project = emptyProject();
    project = addNode(project, 100, 120);
    project = addNode(project, 240, 120);
    project = addNode(project, 380, 120);
    project = addEdge(project, 0, 2);
    project = updateEdgeValues(project, 0, {
      capacitanceText: "C02",
      inductanceText: "L02",
    });
    project = addEdge(project, 1, 2);
    project = updateEdgeValues(project, 1, {
      capacitanceText: "C12",
      inductanceText: "L12",
    });

    const result = mergeNodes(project, 0, [0, 1]);

    expect(result.project.state.nodes.map((node) => node.identifier)).toEqual([0, 2]);
    expect(result.project.state.edges).toHaveLength(1);
    expect(result.project.state.edges[0]).toMatchObject({
      identifier: 0,
      nodes: [0, 2],
      capacitance_text: "(C02) + (C12)",
      inductance_text: "1 / (1 / (L02) + 1 / (L12))",
      is_ground: false,
    });
    expect(hasRegularEdge(result.project.state, 2, 0)).toBe(true);
  });

  it("normalizes desktop-shaped project JSON", () => {
    const project = normalizeProject({
      version: 1,
      state: {
        nodes: [{ identifier: 10, name: "A", x: 1, y: 2 }],
        edges: [
          {
            identifier: 20,
            nodes: [10, -1],
            capacitance_expr: "Cg",
            capacitance_text: "Cg",
            inductance_expr: "Lg",
            inductance_text: "Lg",
            is_ground: true,
          },
        ],
      },
    });

    expect(project.state.node_counter).toBe(11);
    expect(project.state.edge_counter).toBe(21);
    expect(project.state.edges[0]).toMatchObject({
      nodes: [10, -1],
      capacitance_text: "Cg",
      inductance_text: "Lg",
      is_ground: true,
    });
  });

  it("normalizes blank edge value text from loaded project JSON", () => {
    const project = normalizeProject({
      version: 1,
      state: {
        nodes: [
          { identifier: 0, name: "A", x: 1, y: 2 },
          { identifier: 1, name: "B", x: 3, y: 4 },
        ],
        edges: [
          {
            identifier: 0,
            nodes: [0, 1],
            capacitance_text: "   ",
            inductance_text: "\t",
            is_ground: false,
          },
        ],
      },
    });

    expect(project.state.edges[0]).toMatchObject({
      capacitance_text: null,
      inductance_text: null,
    });
  });
});
