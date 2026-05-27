import { addNode } from "./graph";
import {
  GROUND_NODE_ID,
  type CircuitEdge,
  type CircuitProject,
} from "./types";
import type { Point } from "./viewBox";

export const PROJECT_HISTORY_LIMIT = 100;

interface ClipboardNode {
  id: number;
  name: string;
  dx: number;
  dy: number;
}

type ClipboardEdge = Omit<CircuitEdge, "identifier">;

export interface SelectionClipboard {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}

export interface ProjectHistory {
  past: CircuitProject[];
  future: CircuitProject[];
}

export function serializeProjectForDirtyCheck(
  project: CircuitProject,
  extras: string[] = [],
): string {
  return JSON.stringify({ extras, project });
}

export function projectsMatch(
  first: CircuitProject,
  second: CircuitProject,
): boolean {
  return (
    serializeProjectForDirtyCheck(first) === serializeProjectForDirtyCheck(second)
  );
}

export function selectionStatusMessage(nodeCount: number): string {
  return nodeCount === 0
    ? "Selection cleared."
    : `Selected ${nodeCount} node${nodeCount === 1 ? "" : "s"}.`;
}

export function deletionStatusMessage(
  nodeCount: number,
  connectionCount: number,
): string {
  if (nodeCount === 0) {
    return connectionCount === 1
      ? "Deleted 1 connection."
      : `Deleted ${connectionCount} connections.`;
  }

  const nodeText = `${nodeCount} node${nodeCount === 1 ? "" : "s"}`;
  if (connectionCount === 0) {
    return `Deleted ${nodeText}.`;
  }

  const connectionText = `${connectionCount} connection${
    connectionCount === 1 ? "" : "s"
  }`;
  return `Deleted ${nodeText} and ${connectionText}.`;
}

export function appendProjectHistoryEntry(
  history: CircuitProject[],
  project: CircuitProject,
): CircuitProject[] {
  const latest = history[history.length - 1];
  if (latest && projectsMatch(latest, project)) {
    return history;
  }
  return [...history, project].slice(-PROJECT_HISTORY_LIMIT);
}

export function shouldIgnoreAppShortcut(
  target: EventTarget | null,
  hasOpenDialog: boolean,
): boolean {
  if (hasOpenDialog) {
    return true;
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.isContentEditable ||
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"]',
      ),
  );
}

export function clipboardFromSelection(
  project: CircuitProject,
  selectedNodeIds: number[],
): SelectionClipboard | null {
  if (selectedNodeIds.length === 0) {
    return null;
  }

  const selectedIds = new Set(selectedNodeIds);
  const selectedNodes = project.state.nodes.filter((node) =>
    selectedIds.has(node.identifier),
  );
  if (selectedNodes.length === 0) {
    return null;
  }

  const minX = Math.min(...selectedNodes.map((node) => node.x));
  const minY = Math.min(...selectedNodes.map((node) => node.y));
  const nodes = selectedNodes.map((node) => ({
    id: node.identifier,
    name: node.name,
    dx: node.x - minX,
    dy: node.y - minY,
  }));
  const edges = project.state.edges
    .filter((edge) =>
      edge.is_ground
        ? selectedIds.has(edge.nodes[0])
        : selectedIds.has(edge.nodes[0]) && selectedIds.has(edge.nodes[1]),
    )
    .map((edge) => ({
      nodes: [edge.nodes[0], edge.nodes[1]] as [number, number],
      capacitance_expr: edge.capacitance_expr,
      capacitance_text: edge.capacitance_text,
      inductance_expr: edge.inductance_expr,
      inductance_text: edge.inductance_text,
      l_inverse_expr: edge.l_inverse_expr,
      josephson_inductance_expr: edge.josephson_inductance_expr,
      josephson_inductance_text: edge.josephson_inductance_text,
      josephson_phase_sign: edge.josephson_phase_sign,
      is_ground: edge.is_ground,
      ground_offset_x: edge.ground_offset_x,
      ground_offset_y: edge.ground_offset_y,
    }));

  return { nodes, edges };
}

export function pasteSelectionClipboard(
  project: CircuitProject,
  clipboard: SelectionClipboard,
  anchor: Point,
): { project: CircuitProject; nodeIds: number[] } {
  let nextProject = project;
  const nodeIdMap = new Map<number, number>();
  const pastedNodeIds: number[] = [];

  for (const node of clipboard.nodes) {
    nextProject = addNode(nextProject, anchor.x + node.dx, anchor.y + node.dy);
    const newId = nextProject.state.node_counter - 1;
    nodeIdMap.set(node.id, newId);
    pastedNodeIds.push(newId);
  }

  let edgeCounter = nextProject.state.edge_counter;
  const pastedEdges: CircuitEdge[] = [];
  for (const edge of clipboard.edges) {
    if (edge.is_ground) {
      const sourceId = nodeIdMap.get(edge.nodes[0]);
      if (sourceId === undefined) {
        continue;
      }
      pastedEdges.push({
        ...edge,
        identifier: edgeCounter,
        nodes: [sourceId, GROUND_NODE_ID],
      });
      edgeCounter += 1;
      continue;
    }

    const firstId = nodeIdMap.get(edge.nodes[0]);
    const secondId = nodeIdMap.get(edge.nodes[1]);
    if (firstId === undefined || secondId === undefined) {
      continue;
    }
    pastedEdges.push({
      ...edge,
      identifier: edgeCounter,
      nodes: [firstId, secondId],
    });
    edgeCounter += 1;
  }

  return {
    project: {
      ...nextProject,
      state: {
        ...nextProject.state,
        edge_counter: edgeCounter,
        edges: [...nextProject.state.edges, ...pastedEdges],
        selected_nodes: pastedNodeIds,
        focus_node: pastedNodeIds[pastedNodeIds.length - 1] ?? null,
        selected_node: null,
      },
    },
    nodeIds: pastedNodeIds,
  };
}
