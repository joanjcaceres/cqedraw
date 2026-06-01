import { GROUND_NODE_ID, type CircuitEdge, type CircuitProject } from "./types";

export function buildExampleProject(): CircuitProject {
  return {
    version: 2,
    state: {
      node_counter: 3,
      edge_counter: 5,
      view_scale: 1,
      nodes: [
        { identifier: 0, name: "N1", x: 210, y: 260 },
        { identifier: 1, name: "N2", x: 450, y: 220 },
        { identifier: 2, name: "N3", x: 690, y: 260 },
      ],
      edges: [
        createExampleEdge(0, [0, 1], {
          capacitanceText: "Cc",
          inductanceText: "Lr",
        }),
        createExampleEdge(1, [1, 2], {
          capacitanceText: "Cj",
          josephsonInductanceText: "Lj",
        }),
        createExampleEdge(2, [0, GROUND_NODE_ID], {
          capacitanceText: "Cg1",
          isGround: true,
        }),
        createExampleEdge(3, [1, GROUND_NODE_ID], {
          capacitanceText: "Cg2",
          isGround: true,
        }),
        createExampleEdge(4, [2, GROUND_NODE_ID], {
          capacitanceText: "Cg3",
          isGround: true,
        }),
      ],
      selected_nodes: [],
      focus_node: null,
      selected_node: null,
      mode: null,
    },
  };
}

function createExampleEdge(
  identifier: number,
  nodes: [number, number],
  {
    capacitanceText = null,
    inductanceText = null,
    isGround = false,
    josephsonInductanceText = null,
  }: {
    capacitanceText?: string | null;
    inductanceText?: string | null;
    isGround?: boolean;
    josephsonInductanceText?: string | null;
  },
): CircuitEdge {
  return {
    identifier,
    nodes,
    capacitance_expr: capacitanceText,
    capacitance_text: capacitanceText,
    inductance_expr: inductanceText,
    inductance_text: inductanceText,
    l_inverse_expr: null,
    josephson_inductance_expr: josephsonInductanceText,
    josephson_inductance_text: josephsonInductanceText,
    josephson_phase_sign: 1,
    is_ground: isGround,
    ground_offset_x: 0,
    ground_offset_y: isGround ? 104 : 0,
  };
}
