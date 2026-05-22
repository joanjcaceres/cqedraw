import {
  CircuitEdge,
  CircuitNode,
  CircuitProject,
  CircuitState,
  GROUND_NODE_ID,
} from "./types";

const GROUND_LINE_LENGTH = 104;
const CONCATENATE_NODE_RADIUS = 11;
const CONCATENATE_MIN_SPACING = Math.max(CONCATENATE_NODE_RADIUS * 4, 40);
const CONCATENATE_PORT_TOLERANCE = CONCATENATE_NODE_RADIUS * 2;
const CONCATENATE_ZERO_WIDTH = CONCATENATE_NODE_RADIUS * 6;
const COORDINATE_EPSILON = 1e-6;

export interface MergeNodesSummary {
  mergedNodes: number;
  rewiredEdges: number;
  removedSelfLoops: number;
  combinedGroundEdges: number;
}

export interface MergeNodesResult {
  project: CircuitProject;
  summary: MergeNodesSummary;
}

export interface ConcatenateSelectionResult {
  project: CircuitProject;
  nodeIds: number[];
}

export interface ConcatenatePortPair {
  leftNodeId: number;
  rightNodeId: number;
}

export interface ConcatenateNodeOption {
  id: number;
  name: string;
}

export interface ConcatenateSelectionOptions {
  portCount?: number;
  portPairs?: ConcatenatePortPair[];
}

export interface ConcatenateSelectionAnalysis {
  autoPortCount: number;
  detectedPairs: ConcatenatePortPair[];
  maxPortCount: number;
  selectedNodes: ConcatenateNodeOption[];
}

export interface ConcatenatePreviewBridge {
  leftNodeId: number;
  rightNodeId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ConcatenateBoundaryPair {
  left: CircuitNode;
  right: CircuitNode;
}

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
  return createNodeNameAllocator(state)();
}

function createNodeNameAllocator(state: CircuitState): () => string {
  const used = new Set(
    state.nodes
      .map((node) => node.name)
      .filter((name) => /^N\d+$/.test(name))
      .map((name) => Number(name.slice(1))),
  );
  let index = 1;
  return () => {
    while (used.has(index)) {
      index += 1;
    }
    used.add(index);
    return `N${index}`;
  };
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
  return hasRegularEdgeInList(state.edges, firstNode, secondNode);
}

function hasRegularEdgeInList(
  edges: CircuitEdge[],
  firstNode: number,
  secondNode: number,
): boolean {
  return edges.some((edge) => {
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

function hasGroundEdge(edges: CircuitEdge[], nodeId: number): boolean {
  return edges.some((edge) => edge.is_ground && edge.nodes[0] === nodeId);
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

export function moveGroundEdge(
  project: CircuitProject,
  edgeId: number,
  offsetX: number,
  offsetY: number,
): CircuitProject {
  return {
    ...project,
    state: {
      ...project.state,
      edges: project.state.edges.map((edge) =>
        edge.identifier === edgeId && edge.is_ground
          ? {
              ...edge,
              ground_offset_x: offsetX,
              ground_offset_y: offsetY,
            }
          : edge,
      ),
    },
  };
}

export function concatenateSelection(
  project: CircuitProject,
  selectedNodeIds: Iterable<number>,
  repeats: number,
  options: ConcatenateSelectionOptions = {},
): ConcatenateSelectionResult | null {
  const repeatCount = Math.floor(repeats);
  if (repeatCount < 1) {
    return null;
  }

  const selectedNodes = selectedNodesForConcatenate(project, selectedNodeIds);
  if (selectedNodes.length === 0) {
    return null;
  }

  const selectedIdSet = new Set(selectedNodes.map((node) => node.identifier));
  const dx = concatenateRepeatOffset(selectedNodes);

  const originalEdges = project.state.edges.filter((edge) =>
    edge.is_ground
      ? selectedIdSet.has(edge.nodes[0])
      : selectedIdSet.has(edge.nodes[0]) && selectedIdSet.has(edge.nodes[1]),
  );

  const boundaryPairs =
    options.portPairs !== undefined
      ? explicitConcatenateBoundaryPairs(selectedNodes, options.portPairs)
      : concatenateBoundaryPairs(selectedNodes, options.portCount);
  const leftIndexMap = new Map(
    boundaryPairs.map((pair, index) => [pair.left.identifier, index]),
  );
  const currentTailMap = new Map(
    boundaryPairs.map((pair, index) => [index, pair.right.identifier]),
  );

  let nextProject = project;
  let edgeCounter = nextProject.state.edge_counter;
  const nextEdges = [...nextProject.state.edges];
  const allNewNodeIds: number[] = [];
  const allocateNodeName = createNodeNameAllocator(nextProject.state);

  for (let replicaIndex = 1; replicaIndex <= repeatCount; replicaIndex += 1) {
    const nodeIdMap = new Map<number, number>();
    const shiftX = dx * replicaIndex;

    for (const original of selectedNodes) {
      const leftIndex = leftIndexMap.get(original.identifier);
      if (leftIndex !== undefined) {
        const tailNodeId = currentTailMap.get(leftIndex);
        if (tailNodeId !== undefined) {
          nodeIdMap.set(original.identifier, tailNodeId);
          continue;
        }
      }

      const newNodeId = nextProject.state.node_counter;
      const newNode: CircuitNode = {
        identifier: newNodeId,
        name: allocateNodeName(),
        x: original.x + shiftX,
        y: original.y,
      };
      nextProject = {
        ...nextProject,
        state: {
          ...nextProject.state,
          node_counter: newNodeId + 1,
          nodes: [...nextProject.state.nodes, newNode],
        },
      };
      nodeIdMap.set(original.identifier, newNodeId);
      allNewNodeIds.push(newNodeId);
    }

    for (const edge of originalEdges) {
      if (edge.is_ground) {
        const sourceId = nodeIdMap.get(edge.nodes[0]);
        if (
          sourceId !== undefined &&
          !hasGroundEdge(nextEdges, sourceId)
        ) {
          nextEdges.push({
            ...edge,
            identifier: edgeCounter,
            nodes: [sourceId, GROUND_NODE_ID] as [number, number],
          });
          edgeCounter += 1;
        }
        continue;
      }

      const firstId = nodeIdMap.get(edge.nodes[0]);
      const secondId = nodeIdMap.get(edge.nodes[1]);
      if (
        firstId !== undefined &&
        secondId !== undefined &&
        firstId !== secondId &&
        !hasRegularEdgeInList(nextEdges, firstId, secondId)
      ) {
        nextEdges.push({
          ...edge,
          identifier: edgeCounter,
          nodes: [firstId, secondId] as [number, number],
        });
        edgeCounter += 1;
      }
    }

    for (const [index, pair] of boundaryPairs.entries()) {
      const tailNodeId = nodeIdMap.get(pair.right.identifier);
      if (tailNodeId !== undefined) {
        currentTailMap.set(index, tailNodeId);
      }
    }
  }

  if (allNewNodeIds.length === 0) {
    return null;
  }

  return {
    project: {
      ...nextProject,
      state: {
        ...nextProject.state,
        edge_counter: edgeCounter,
        edges: nextEdges,
        selected_nodes: allNewNodeIds,
        focus_node: allNewNodeIds[allNewNodeIds.length - 1] ?? null,
        selected_node: null,
      },
    },
    nodeIds: allNewNodeIds,
  };
}

export function analyzeConcatenateSelection(
  project: CircuitProject,
  selectedNodeIds: Iterable<number>,
): ConcatenateSelectionAnalysis {
  const selectedNodes = selectedNodesForConcatenate(project, selectedNodeIds);
  if (selectedNodes.length === 0) {
    return {
      autoPortCount: 0,
      detectedPairs: [],
      maxPortCount: 0,
      selectedNodes: [],
    };
  }
  const detectedPairs = concatenatePortPairsForNodes(selectedNodes);
  return {
    autoPortCount: detectedPairs.length,
    detectedPairs,
    maxPortCount: maxConcatenatePortCount(selectedNodes),
    selectedNodes: selectedNodes.map((node) => ({
      id: node.identifier,
      name: node.name,
    })),
  };
}

export function concatenatePortPairsForSelection(
  project: CircuitProject,
  selectedNodeIds: Iterable<number>,
  requestedPortCount?: number,
): ConcatenatePortPair[] {
  return concatenatePortPairsForNodes(
    selectedNodesForConcatenate(project, selectedNodeIds),
    requestedPortCount,
  );
}

export function concatenatePortPairsForNodes(
  selectedNodes: CircuitNode[],
  requestedPortCount?: number,
): ConcatenatePortPair[] {
  return concatenateBoundaryPairs(selectedNodes, requestedPortCount).map((pair) => ({
    leftNodeId: pair.left.identifier,
    rightNodeId: pair.right.identifier,
  }));
}

export function concatenatePreviewBridgesForSelection(
  project: CircuitProject,
  selectedNodeIds: Iterable<number>,
  portPairs: ConcatenatePortPair[],
): ConcatenatePreviewBridge[] {
  const selectedNodes = selectedNodesForConcatenate(project, selectedNodeIds);
  if (selectedNodes.length === 0) {
    return [];
  }

  const dx = concatenateRepeatOffset(selectedNodes);
  return explicitConcatenateBoundaryPairs(selectedNodes, portPairs).map((pair) => ({
    leftNodeId: pair.left.identifier,
    rightNodeId: pair.right.identifier,
    x1: pair.right.x,
    y1: pair.right.y,
    x2: pair.left.x + dx,
    y2: pair.left.y,
  }));
}

function selectedNodesForConcatenate(
  project: CircuitProject,
  selectedNodeIds: Iterable<number>,
): CircuitNode[] {
  const nodesById = new Map(
    project.state.nodes.map((node) => [node.identifier, node]),
  );
  return [...new Set(selectedNodeIds)]
    .sort((first, second) => first - second)
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is CircuitNode => node !== undefined);
}

function concatenateBoundaryPairs(
  selectedNodes: CircuitNode[],
  requestedPortCount?: number,
): ConcatenateBoundaryPair[] {
  if (maxConcatenatePortCount(selectedNodes) === 0) {
    return [];
  }

  if (requestedPortCount !== undefined) {
    return requestedConcatenateBoundaryPairs(selectedNodes, requestedPortCount);
  }

  const minX = Math.min(...selectedNodes.map((node) => node.x));
  const maxX = Math.max(...selectedNodes.map((node) => node.x));
  const blockWidth = maxX - minX;
  const boundaryTolerance = Math.min(
    CONCATENATE_PORT_TOLERANCE,
    blockWidth / 3,
  );
  const leftNodes = selectedNodes
    .filter((node) => node.x <= minX + boundaryTolerance)
    .sort(compareNodesByYThenX);
  const leftIds = new Set(leftNodes.map((node) => node.identifier));
  const rightNodes = selectedNodes
    .filter(
      (node) =>
        node.x >= maxX - boundaryTolerance && !leftIds.has(node.identifier),
    )
    .sort(compareNodesByYThenX);

  return pairBoundaryNodes(leftNodes, rightNodes);
}

function requestedConcatenateBoundaryPairs(
  selectedNodes: CircuitNode[],
  requestedPortCount: number,
): ConcatenateBoundaryPair[] {
  const portCount = clampNumber(
    Math.floor(requestedPortCount),
    0,
    maxConcatenatePortCount(selectedNodes),
  );
  if (portCount === 0) {
    return [];
  }

  const leftNodes = [...selectedNodes]
    .sort(compareNodesByXThenY)
    .slice(0, portCount)
    .sort(compareNodesByYThenX);
  const leftIds = new Set(leftNodes.map((node) => node.identifier));
  const rightNodes = selectedNodes
    .filter((node) => !leftIds.has(node.identifier))
    .sort((first, second) => compareNodesByXThenY(second, first))
    .slice(0, portCount)
    .sort(compareNodesByYThenX);

  return pairBoundaryNodes(leftNodes, rightNodes);
}

function explicitConcatenateBoundaryPairs(
  selectedNodes: CircuitNode[],
  requestedPairs: ConcatenatePortPair[],
): ConcatenateBoundaryPair[] {
  const nodeById = new Map(
    selectedNodes.map((node) => [node.identifier, node]),
  );
  const usedLeftNodeIds = new Set<number>();
  const usedRightNodeIds = new Set<number>();
  const boundaryPairs: ConcatenateBoundaryPair[] = [];

  for (const requestedPair of requestedPairs) {
    if (
      requestedPair.leftNodeId === requestedPair.rightNodeId ||
      usedLeftNodeIds.has(requestedPair.leftNodeId) ||
      usedRightNodeIds.has(requestedPair.rightNodeId)
    ) {
      continue;
    }
    const left = nodeById.get(requestedPair.leftNodeId);
    const right = nodeById.get(requestedPair.rightNodeId);
    if (!left || !right) {
      continue;
    }
    boundaryPairs.push({ left, right });
    usedLeftNodeIds.add(left.identifier);
    usedRightNodeIds.add(right.identifier);
  }

  return boundaryPairs;
}

function pairBoundaryNodes(
  leftNodes: CircuitNode[],
  rightNodes: CircuitNode[],
): ConcatenateBoundaryPair[] {
  const pairCount = Math.min(leftNodes.length, rightNodes.length);
  return Array.from({ length: pairCount }, (_, index) => ({
    left: leftNodes[index],
    right: rightNodes[index],
  }));
}

function maxConcatenatePortCount(selectedNodes: CircuitNode[]): number {
  if (selectedNodes.length < 2) {
    return 0;
  }
  const minX = Math.min(...selectedNodes.map((node) => node.x));
  const maxX = Math.max(...selectedNodes.map((node) => node.x));
  if (maxX - minX <= COORDINATE_EPSILON) {
    return 0;
  }
  return Math.floor(selectedNodes.length / 2);
}

function concatenateRepeatOffset(selectedNodes: CircuitNode[]): number {
  const minX = Math.min(...selectedNodes.map((node) => node.x));
  const maxX = Math.max(...selectedNodes.map((node) => node.x));
  const blockWidth = maxX - minX;
  return (
    (blockWidth > COORDINATE_EPSILON ? blockWidth : CONCATENATE_ZERO_WIDTH) +
    CONCATENATE_MIN_SPACING
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function compareNodesByXThenY(first: CircuitNode, second: CircuitNode): number {
  return first.x - second.x || first.y - second.y || first.identifier - second.identifier;
}

function compareNodesByYThenX(first: CircuitNode, second: CircuitNode): number {
  return first.y - second.y || first.x - second.x || first.identifier - second.identifier;
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

export function mergeNodes(
  project: CircuitProject,
  survivorId: number,
  selectedNodeIds: Iterable<number>,
): MergeNodesResult {
  const selectedIds = new Set(selectedNodeIds);
  const existingNodeIds = new Set(
    project.state.nodes.map((node) => node.identifier),
  );
  const mergedNodeIds = new Set(
    [...selectedIds].filter(
      (nodeId) => nodeId !== survivorId && existingNodeIds.has(nodeId),
    ),
  );
  const emptySummary: MergeNodesSummary = {
    mergedNodes: 0,
    rewiredEdges: 0,
    removedSelfLoops: 0,
    combinedGroundEdges: 0,
  };

  if (!existingNodeIds.has(survivorId) || mergedNodeIds.size === 0) {
    return { project, summary: emptySummary };
  }

  let rewiredEdges = 0;
  let removedSelfLoops = 0;
  let edgesOut: CircuitEdge[] = [];
  const survivorGroundEdges: CircuitEdge[] = [];

  for (const edge of project.state.edges) {
    if (edge.is_ground) {
      const sourceId = edge.nodes[0];
      const nextSourceId = mergedNodeIds.has(sourceId) ? survivorId : sourceId;
      const nextEdge =
        nextSourceId === sourceId
          ? edge
          : {
              ...edge,
              nodes: [survivorId, GROUND_NODE_ID] as [number, number],
            };

      if (nextSourceId !== sourceId) {
        rewiredEdges += 1;
      }
      if (nextEdge.nodes[0] === survivorId) {
        if (sourceId === survivorId) {
          survivorGroundEdges.unshift(nextEdge);
        } else {
          survivorGroundEdges.push(nextEdge);
        }
      } else {
        edgesOut.push(nextEdge);
      }
      continue;
    }

    const first = mergedNodeIds.has(edge.nodes[0]) ? survivorId : edge.nodes[0];
    const second = mergedNodeIds.has(edge.nodes[1]) ? survivorId : edge.nodes[1];
    if (first !== edge.nodes[0] || second !== edge.nodes[1]) {
      rewiredEdges += 1;
    }
    if (first === second) {
      removedSelfLoops += 1;
      continue;
    }
    edgesOut.push(
      first === edge.nodes[0] && second === edge.nodes[1]
        ? edge
        : { ...edge, nodes: [first, second] },
    );
  }

  edgesOut = combineRegularEdgesByPair(edgesOut);

  let combinedGroundEdges = 0;
  if (survivorGroundEdges.length === 1) {
    edgesOut.push(survivorGroundEdges[0]);
  } else if (survivorGroundEdges.length > 1) {
    combinedGroundEdges = survivorGroundEdges.length - 1;
    edgesOut.push(combineGroundEdges(survivorGroundEdges));
  }

  return {
    project: {
      ...project,
      state: {
        ...project.state,
        nodes: project.state.nodes.filter(
          (node) => !mergedNodeIds.has(node.identifier),
        ),
        edges: edgesOut.sort((first, second) => first.identifier - second.identifier),
        selected_nodes: [survivorId],
        focus_node: survivorId,
        selected_node: null,
      },
    },
    summary: {
      mergedNodes: mergedNodeIds.size,
      rewiredEdges,
      removedSelfLoops,
      combinedGroundEdges,
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

function combineGroundEdges(edges: CircuitEdge[]): CircuitEdge {
  const [base] = edges;
  const capacitanceText = sumTexts(
    edges.map((edge) => edge.capacitance_text ?? edge.capacitance_expr),
  );
  const inductanceText = parallelInductanceText(
    edges.map((edge) => edge.inductance_text ?? edge.inductance_expr),
  );

  return {
    ...base,
    nodes: [base.nodes[0], GROUND_NODE_ID],
    capacitance_expr: capacitanceText,
    capacitance_text: capacitanceText,
    inductance_expr: inductanceText,
    inductance_text: inductanceText,
    l_inverse_expr: null,
  };
}

function combineRegularEdgesByPair(edges: CircuitEdge[]): CircuitEdge[] {
  const regularEdgeGroups = new Map<string, CircuitEdge[]>();
  const passthroughEdges: CircuitEdge[] = [];

  for (const edge of edges) {
    if (edge.is_ground) {
      passthroughEdges.push(edge);
      continue;
    }
    const [first, second] = edge.nodes;
    const key = first < second ? `${first}:${second}` : `${second}:${first}`;
    const group = regularEdgeGroups.get(key);
    if (group) {
      group.push(edge);
    } else {
      regularEdgeGroups.set(key, [edge]);
    }
  }

  for (const group of regularEdgeGroups.values()) {
    passthroughEdges.push(
      group.length === 1 ? group[0] : combineRegularEdges(group),
    );
  }

  return passthroughEdges;
}

function combineRegularEdges(edges: CircuitEdge[]): CircuitEdge {
  const [base] = edges;
  const capacitanceText = sumTexts(
    edges.map((edge) => edge.capacitance_text ?? edge.capacitance_expr),
  );
  const inductanceText = parallelInductanceText(
    edges.map((edge) => edge.inductance_text ?? edge.inductance_expr),
  );

  return {
    ...base,
    capacitance_expr: capacitanceText,
    capacitance_text: capacitanceText,
    inductance_expr: inductanceText,
    inductance_text: inductanceText,
    l_inverse_expr: null,
  };
}

function sumTexts(values: Array<string | null>): string | null {
  const terms = values.filter((value): value is string => Boolean(value?.trim()));
  return terms.length > 0 ? terms.map(parenthesize).join(" + ") : null;
}

function parallelInductanceText(values: Array<string | null>): string | null {
  const terms = values.filter((value): value is string => Boolean(value?.trim()));
  if (terms.length === 0) {
    return null;
  }
  return `1 / (${terms.map((term) => `1 / ${parenthesize(term)}`).join(" + ")})`;
}

function parenthesize(value: string): string {
  return `(${value.trim()})`;
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
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
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
