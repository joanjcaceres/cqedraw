export const GROUND_NODE_ID = -1;

export type ToolMode = "select" | "box-select" | "node" | "edge" | "ground";

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
  josephson_inductance_expr: string | null;
  josephson_inductance_text: string | null;
  josephson_phase_sign: 1 | -1;
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
  parameters: string[];
  c_parameters: string[];
  l_inv_parameters: string[];
  josephson_parameters: string[];
  josephson_branches: JosephsonBranchRecord[];
  matrix_nodes: MatrixNodeRecord[];
  snippet: string;
  error?: string;
}

export interface MatrixNodeRecord {
  project_node_id: number;
  matrix_index: number;
  name: string | null;
}

export interface JosephsonBranchRecord {
  edge_id: number | null;
  project_nodes: [number, number];
  matrix_nodes: [number, number | null];
  phase_positive_index: number | null;
  phase_negative_index: number | null;
  phase_sign: 1 | -1;
  inductance_expr: string;
}

export interface EvaluatedJosephsonBranchRecord extends JosephsonBranchRecord {
  L_j: number;
  E_j_GHz: number;
}

export interface ModalBranchRecord extends EvaluatedJosephsonBranchRecord {
  phase_nodes: [number | null, number | null];
  phase_zpf: number[];
}

export interface ModalAnalysisResult {
  available: boolean;
  frequencies_ghz?: number[];
  branch_phase_zpfs?: number[][];
  josephson_energies_ghz?: number[] | null;
  branches?: ModalBranchRecord[];
  error?: string;
  details?: string;
}

export interface StructuredExportResult {
  format: string;
  schema_version: number;
  cqedraw_project_version: number;
  units: Record<string, string>;
  project: CircuitProject;
  NODE_INDEX_MAP: Record<string, number>;
  matrix_nodes: MatrixNodeRecord[];
  PARAMETER_NAMES: string[];
  C_PARAMETER_NAMES: string[];
  L_INV_PARAMETER_NAMES: string[];
  JOSEPHSON_PARAMETER_NAMES: string[];
  parameter_values: Record<string, number>;
  parameter_value_text: Record<string, string>;
  symbolic: {
    C_entries: MatrixEntryRecord[];
    L_inv_entries: MatrixEntryRecord[];
    JOSEPHSON_BRANCHES: JosephsonBranchRecord[];
  };
  C_matrix: number[][];
  L_inv_matrix: number[][];
  JOSEPHSON_BRANCHES: EvaluatedJosephsonBranchRecord[];
  modal_analysis: ModalAnalysisResult | null;
  error?: string;
}

export interface SelectionState {
  mode: ToolMode;
  selectedNodeId: number | null;
  selectedEdgeId: number | null;
  pendingEdgeNodeId: number | null;
}
