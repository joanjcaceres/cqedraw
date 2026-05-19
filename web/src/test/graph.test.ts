import { describe, expect, it } from "vitest";

import {
  addEdge,
  addNode,
  emptyProject,
  normalizeProject,
  removeNode,
  sampleProject,
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

  it("removes node-connected edges", () => {
    let project = sampleProject();
    project = removeNode(project, 1);

    expect(project.state.nodes.map((node) => node.identifier)).toEqual([0, 2]);
    expect(project.state.edges).toHaveLength(1);
    expect(project.state.edges[0].nodes).toEqual([2, GROUND_NODE_ID]);
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
});
