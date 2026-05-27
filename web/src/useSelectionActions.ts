import { mergeNodes, removeEdge, removeNode } from "./graph";
import { deletionStatusMessage } from "./projectState";
import type { CircuitProject } from "./types";

interface UseSelectionActionsOptions {
  commitProjectChange: (
    updateProject: (current: CircuitProject) => CircuitProject,
  ) => void;
  project: CircuitProject;
  projectRef: { current: CircuitProject };
  recordProjectHistory: (project: CircuitProject) => void;
  resetProjectInteractionState: () => void;
  selectedEdgeId: number | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  setEngineStatus: (message: string) => void;
  setGroundDragState: (state: null) => void;
  setOutput: (output: null) => void;
  setPendingEdgeNodeId: (nodeId: number | null) => void;
  setProjectState: (project: CircuitProject) => void;
  setSelectedEdgeId: (edgeId: number | null) => void;
  setSelectedNodeId: (nodeId: number | null) => void;
  setSelectedNodeIds: (nodeIds: number[]) => void;
}

export function useSelectionActions({
  commitProjectChange,
  project,
  projectRef,
  recordProjectHistory,
  resetProjectInteractionState,
  selectedEdgeId,
  selectedNodeId,
  selectedNodeIds,
  setEngineStatus,
  setGroundDragState,
  setOutput,
  setPendingEdgeNodeId,
  setProjectState,
  setSelectedEdgeId,
  setSelectedNodeId,
  setSelectedNodeIds,
}: UseSelectionActionsOptions) {
  function deleteSelection() {
    if (selectedEdgeId !== null) {
      const edge = project.state.edges.find(
        (candidate) => candidate.identifier === selectedEdgeId,
      );
      commitProjectChange((current) => removeEdge(current, selectedEdgeId));
      resetProjectInteractionState();
      setOutput(null);
      setEngineStatus(
        edge?.is_ground ? "Deleted ground connection." : "Deleted connection.",
      );
      return;
    }
    const nodeIdsToDelete =
      selectedNodeIds.length > 0
        ? selectedNodeIds
        : selectedNodeId !== null
          ? [selectedNodeId]
          : [];
    if (nodeIdsToDelete.length > 0) {
      const selectedIds = new Set(nodeIdsToDelete);
      const deletedNodeCount = project.state.nodes.filter((node) =>
        selectedIds.has(node.identifier),
      ).length;
      const deletedConnectionCount = project.state.edges.filter((edge) =>
        edge.nodes.some((nodeId) => selectedIds.has(nodeId)),
      ).length;
      commitProjectChange((current) =>
        nodeIdsToDelete.reduce(
          (nextProject, nodeId) => removeNode(nextProject, nodeId),
          current,
        ),
      );
      resetProjectInteractionState();
      setOutput(null);
      setEngineStatus(
        deletionStatusMessage(deletedNodeCount, deletedConnectionCount),
      );
    }
  }

  function mergeSelectedNodes() {
    if (selectedNodeId === null || selectedNodeIds.length < 2) {
      setEngineStatus("Select at least two nodes to merge.");
      return;
    }

    const result = mergeNodes(project, selectedNodeId, selectedNodeIds);
    if (result.summary.mergedNodes === 0) {
      setEngineStatus("No nodes were merged.");
      return;
    }

    const survivor =
      result.project.state.nodes.find((node) => node.identifier === selectedNodeId) ??
      null;
    const details: string[] = [];
    if (result.summary.removedSelfLoops > 0) {
      details.push(
        `removed ${result.summary.removedSelfLoops} internal connection(s)`,
      );
    }
    if (result.summary.combinedGroundEdges > 0) {
      details.push(
        `combined ${result.summary.combinedGroundEdges + 1} ground connection(s)`,
      );
    }
    const detailText = details.length > 0 ? ` (${details.join("; ")})` : "";

    recordProjectHistory(projectRef.current);
    setProjectState(result.project);
    setSelectedNodeIds([selectedNodeId]);
    setSelectedNodeId(selectedNodeId);
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setGroundDragState(null);
    setOutput(null);
    setEngineStatus(
      `Merged ${selectedNodeIds.length} nodes into ${survivor?.name ?? `Node ${selectedNodeId}`}.${detailText}`,
    );
  }

  return {
    deleteSelection,
    mergeSelectedNodes,
  };
}
