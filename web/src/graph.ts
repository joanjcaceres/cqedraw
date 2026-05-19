import { CircuitEdge, CircuitProject, CircuitState, GROUND_NODE_ID } from "./types";

const GROUND_LINE_LENGTH = 104;

export function emptyProject(): CircuitProject {
  return {
    version: 1,
    state: {
      node_counter: 0,
      edge_counter: 0,
      view_scale: 1,
      nodes: [],
      edges: [],
      selected_nodes: [],
      focus_node: null,
      selected_node: null,
      mode: null,
    },
  };
}

export function nextNodeName(state: CircuitState): string {
  const used = new Set(
    state.nodes
      .map((node) => node.name)
      .filter((name) => /^N\d+$/.test(name))
      .map((name) => Number(name.slice(1))),
  );
  let index = 1;
  while (used.has(index)) {
    index += 1;
  }
  return `N${index}`;
}

export function addNode(project: CircuitProject, x: number, y: number): CircuitProject {
  const id = project.state.node_counter;
  return {
    ...project,
    state: {
      ...project.state,
      node_counter: id + 1,
      nodes: [
        ...project.state.nodes,
        {
          identifier: id,
          name: nextNodeName(project.state),
          x,
          y,
        },
      ],
      selected_nodes: [id],
      focus_node: id,
      selected_node: id,
    },
  };
}

export function moveNode(
  project: CircuitProject,
  nodeId: number,
  x: number,
  y: number,
): CircuitProject {
  return {
    ...project,
    state: {
      ...project.state,
      nodes: project.state.nodes.map((node) =>
        node.identifier === nodeId ? { ...node, x, y } : node,
      ),
    },
  };
}

export function renameNode(
  project: CircuitProject,
  nodeId: number,
  name: string,
): CircuitProject {
  const trimmed = name.trim();
  if (!trimmed) {
    return project;
  }
  return {
    ...project,
    state: {
      ...project.state,
      nodes: project.state.nodes.map((node) =>
        node.identifier === nodeId ? { ...node, name: trimmed } : node,
      ),
    },
  };
}

export function addEdge(
  project: CircuitProject,
  firstNode: number,
  secondNode: number,
): CircuitProject {
  if (firstNode === secondNode || hasRegularEdge(project.state, firstNode, secondNode)) {
    return project;
  }
  const id = project.state.edge_counter;
  return {
    ...project,
    state: {
      ...project.state,
      edge_counter: id + 1,
      edges: [
        ...project.state.edges,
        createEdge(id, [firstNode, secondNode], false),
      ],
    },
  };
}

export function hasRegularEdge(
  state: CircuitState,
  firstNode: number,
  secondNode: number,
): boolean {
  return state.edges.some((edge) => {
    if (edge.is_ground) {
      return false;
    }
    const [first, second] = edge.nodes;
    return (
      (first === firstNode && second === secondNode) ||
      (first === secondNode && second === firstNode)
    );
  });
}

export function toggleGround(project: CircuitProject, nodeId: number): CircuitProject {
  const existing = project.state.edges.find(
    (edge) => edge.is_ground && edge.nodes[0] === nodeId,
  );
  if (existing) {
    return removeEdge(project, existing.identifier);
  }

  const id = project.state.edge_counter;
  return {
    ...project,
    state: {
      ...project.state,
      edge_counter: id + 1,
      edges: [
        ...project.state.edges,
        createEdge(id, [nodeId, GROUND_NODE_ID], true),
      ],
    },
  };
}

export function updateEdgeValues(
  project: CircuitProject,
  edgeId: number,
  values: { capacitanceText?: string | null; inductanceText?: string | null },
): CircuitProject {
  return {
    ...project,
    state: {
      ...project.state,
      edges: project.state.edges.map((edge) => {
        if (edge.identifier !== edgeId) {
          return edge;
        }
        const cap = normalizeText(values.capacitanceText, edge.capacitance_text);
        const ind = normalizeText(values.inductanceText, edge.inductance_text);
        return {
          ...edge,
          capacitance_expr: cap,
          capacitance_text: cap,
          inductance_expr: ind,
          inductance_text: ind,
          l_inverse_expr: null,
        };
      }),
    },
  };
}

export function removeNode(project: CircuitProject, nodeId: number): CircuitProject {
  return {
    ...project,
    state: {
      ...project.state,
      nodes: project.state.nodes.filter((node) => node.identifier !== nodeId),
      edges: project.state.edges.filter((edge) => !edge.nodes.includes(nodeId)),
      selected_nodes: project.state.selected_nodes.filter((id) => id !== nodeId),
      focus_node: project.state.focus_node === nodeId ? null : project.state.focus_node,
      selected_node:
        project.state.selected_node === nodeId ? null : project.state.selected_node,
    },
  };
}

export function removeEdge(project: CircuitProject, edgeId: number): CircuitProject {
  return {
    ...project,
    state: {
      ...project.state,
      edges: project.state.edges.filter((edge) => edge.identifier !== edgeId),
    },
  };
}

export function normalizeProject(input: unknown): CircuitProject {
  const project = asRecord(input);
  const state = asRecord(project.state ?? project);
  const nodes = asArray(state.nodes).map((node, index) => {
    const record = asRecord(node);
    const identifier = Number(record.identifier ?? index);
    return {
      identifier,
      name: String(record.name ?? `N${identifier}`),
      x: Number(record.x ?? 0),
      y: Number(record.y ?? 0),
    };
  });
  const edges = asArray(state.edges)
    .map((edge, index) => normalizeEdge(asRecord(edge), index))
    .filter((edge): edge is CircuitEdge => edge !== null);

  return {
    version: Number(project.version ?? 1),
    state: {
      node_counter: Number(
        state.node_counter ??
          Math.max(-1, ...nodes.map((node) => node.identifier)) + 1,
      ),
      edge_counter: Number(
        state.edge_counter ??
          Math.max(-1, ...edges.map((edge) => edge.identifier)) + 1,
      ),
      view_scale: Number(state.view_scale ?? 1),
      nodes,
      edges,
      selected_nodes: [],
      focus_node: null,
      selected_node: null,
      mode: null,
    },
  };
}

function createEdge(
  id: number,
  nodes: [number, number],
  isGround: boolean,
): CircuitEdge {
  return {
    identifier: id,
    nodes,
    capacitance_expr: null,
    capacitance_text: null,
    inductance_expr: null,
    inductance_text: null,
    l_inverse_expr: null,
    is_ground: isGround,
    ground_offset_x: 0,
    ground_offset_y: GROUND_LINE_LENGTH,
  };
}

function normalizeText(
  incoming: string | null | undefined,
  current: string | null,
): string | null {
  if (incoming === undefined) {
    return current;
  }
  const trimmed = incoming?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function normalizeEdge(record: Record<string, unknown>, index: number): CircuitEdge | null {
  const nodes = asArray(record.nodes);
  if (nodes.length !== 2) {
    return null;
  }
  const cap = textValue(record.capacitance_text ?? record.capacitance_expr);
  const ind = textValue(record.inductance_text ?? record.inductance_expr);
  const first = Number(nodes[0]);
  const second = Number(nodes[1]);
  const isGround = Boolean(record.is_ground ?? second === GROUND_NODE_ID);
  return {
    identifier: Number(record.identifier ?? index),
    nodes: [first, second],
    capacitance_expr: cap,
    capacitance_text: cap,
    inductance_expr: ind,
    inductance_text: ind,
    l_inverse_expr: null,
    is_ground: isGround,
    ground_offset_x: Number(record.ground_offset_x ?? 0),
    ground_offset_y: Number(record.ground_offset_y ?? GROUND_LINE_LENGTH),
  };
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
