import {
  CircuitEdge,
  CircuitNode,
  CircuitProject,
  CircuitState,
  GROUND_NODE_ID,
} from "./types";

const CONCATENATE_NODE_RADIUS = 11;
const CONCATENATE_MIN_SPACING = Math.max(CONCATENATE_NODE_RADIUS * 4, 40);
const CONCATENATE_PORT_TOLERANCE = CONCATENATE_NODE_RADIUS * 2;
const CONCATENATE_ZERO_WIDTH = CONCATENATE_NODE_RADIUS * 6;
const COORDINATE_EPSILON = 1e-6;

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
        if (sourceId !== undefined && !hasGroundEdge(nextEdges, sourceId)) {
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
  const usedNodeIds = new Set<number>();
  const boundaryPairs: ConcatenateBoundaryPair[] = [];

  for (const requestedPair of requestedPairs) {
    if (
      requestedPair.leftNodeId === requestedPair.rightNodeId ||
      usedNodeIds.has(requestedPair.leftNodeId) ||
      usedNodeIds.has(requestedPair.rightNodeId)
    ) {
      continue;
    }
    const left = nodeById.get(requestedPair.leftNodeId);
    const right = nodeById.get(requestedPair.rightNodeId);
    if (!left || !right) {
      continue;
    }
    boundaryPairs.push({ left, right });
    usedNodeIds.add(left.identifier);
    usedNodeIds.add(right.identifier);
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function compareNodesByXThenY(first: CircuitNode, second: CircuitNode): number {
  return first.x - second.x || first.y - second.y || first.identifier - second.identifier;
}

function compareNodesByYThenX(first: CircuitNode, second: CircuitNode): number {
  return first.y - second.y || first.x - second.x || first.identifier - second.identifier;
}
