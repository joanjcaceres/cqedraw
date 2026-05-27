import { useMemo, useState, type RefObject } from "react";

import {
  analyzeConcatenateSelection,
  concatenatePortPairsForSelection,
  concatenatePreviewBridgesForSelection,
  concatenateSelection,
  type ConcatenatePortPair,
} from "./graph";
import type { CircuitProject, ToolMode } from "./types";

interface UseConcatenateWorkflowOptions {
  concatenateButtonRef: RefObject<HTMLButtonElement | null>;
  onResetTransientInteractionState: () => void;
  project: CircuitProject;
  projectRef: { current: CircuitProject };
  recordProjectHistory: (project: CircuitProject) => void;
  selectedNodeIds: number[];
  setEngineStatus: (message: string) => void;
  setMode: (mode: ToolMode) => void;
  setOutput: (output: null) => void;
  setProjectState: (project: CircuitProject) => void;
  setSelectedEdgeId: (edgeId: number | null) => void;
  setSelectedNodeId: (nodeId: number | null) => void;
  setSelectedNodeIds: (nodeIds: number[]) => void;
}

export function useConcatenateWorkflow({
  concatenateButtonRef,
  onResetTransientInteractionState,
  project,
  projectRef,
  recordProjectHistory,
  selectedNodeIds,
  setEngineStatus,
  setMode,
  setOutput,
  setProjectState,
  setSelectedEdgeId,
  setSelectedNodeId,
  setSelectedNodeIds,
}: UseConcatenateWorkflowOptions) {
  const [concatenatePreviewPairs, setConcatenatePreviewPairs] = useState<
    ConcatenatePortPair[]
  >([]);
  const [concatenateDialogOpen, setConcatenateDialogOpen] = useState(false);
  const concatenateAnalysis = useMemo(
    () => analyzeConcatenateSelection(project, selectedNodeIds),
    [project, selectedNodeIds],
  );
  const concatenatePreviewBridges = useMemo(
    () =>
      concatenateDialogOpen
        ? concatenatePreviewBridgesForSelection(
            project,
            selectedNodeIds,
            concatenatePreviewPairs,
          )
        : [],
    [concatenateDialogOpen, concatenatePreviewPairs, project, selectedNodeIds],
  );

  function openConcatenateDialog() {
    if (selectedNodeIds.length === 0) {
      setEngineStatus("Select at least one node to concatenate.");
      return;
    }
    onResetTransientInteractionState();
    setConcatenatePreviewPairs(concatenateAnalysis.detectedPairs);
    setConcatenateDialogOpen(true);
  }

  function closeConcatenateDialog() {
    setConcatenatePreviewPairs([]);
    setConcatenateDialogOpen(false);
    window.requestAnimationFrame(() => concatenateButtonRef.current?.focus());
  }

  function concatenateSelectedGraphElements(
    repeats: number,
    portPairs: ConcatenatePortPair[],
  ) {
    const result = concatenateSelection(projectRef.current, selectedNodeIds, repeats, {
      portPairs,
    });
    closeConcatenateDialog();
    if (!result) {
      setEngineStatus("No repeatable nodes were added.");
      return;
    }

    recordProjectHistory(projectRef.current);
    setProjectState(result.project);
    setSelectedNodeIds(result.nodeIds);
    setSelectedNodeId(result.nodeIds[result.nodeIds.length - 1] ?? null);
    setSelectedEdgeId(null);
    onResetTransientInteractionState();
    setMode("select");
    setOutput(null);
    setEngineStatus(
      `Concatenated ${repeats} repeat${repeats === 1 ? "" : "s"}; added ${result.nodeIds.length} node(s).`,
    );
  }

  function concatenatePortPairsForPortCount(portCount: number) {
    return concatenatePortPairsForSelection(
      projectRef.current,
      selectedNodeIds,
      portCount,
    );
  }

  return {
    concatenateAnalysis,
    concatenateDialogOpen,
    concatenatePreviewBridges,
    closeConcatenateDialog,
    concatenatePortPairsForPortCount,
    concatenateSelectedGraphElements,
    openConcatenateDialog,
    setConcatenatePreviewPairs,
  };
}
