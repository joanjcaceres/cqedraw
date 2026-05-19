export const GROUND_NODE_ID = -1;

export type ToolMode = "select" | "node" | "edge" | "ground";

export interface CircuitNode {
  identifier: number;
  name: string;
  x: number;
  y: number;
}

export interface CircuitEdge {
  identifier: number;
  nodes: [number, number];
  capacitance_expr: string | null;
  capacitance_text: string | null;
  inductance_expr: string | null;
  inductance_text: string | null;
  l_inverse_expr: string | null;
  is_ground: boolean;
  ground_offset_x: number;
  ground_offset_y: number;
}

export interface CircuitState {
  node_counter: number;
  edge_counter: number;
  view_scale: number;
  nodes: CircuitNode[];
  edges: CircuitEdge[];
  selected_nodes: number[];
  focus_node: number | null;
  selected_node: number | null;
  mode: ToolMode | null;
}

export interface CircuitProject {
  version: number;
  state: CircuitState;
}

export interface MatrixEntryRecord {
  row: number;
  col: number;
  expr: string;
}

export interface OutputResult {
  size: number;
  c_entries: MatrixEntryRecord[];
  l_inv_entries: MatrixEntryRecord[];
  c_parameters: string[];
  l_inv_parameters: string[];
  snippet: string;
  error?: string;
}

export interface SelectionState {
  mode: ToolMode;
  selectedNodeId: number | null;
  selectedEdgeId: number | null;
  pendingEdgeNodeId: number | null;
}
