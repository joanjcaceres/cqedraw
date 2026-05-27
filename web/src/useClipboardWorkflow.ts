import { useState } from "react";

import {
  clipboardFromSelection,
  pasteSelectionClipboard,
  type SelectionClipboard,
} from "./projectState";
import type { CircuitProject, ToolMode } from "./types";
import type { Point, ViewBox } from "./viewBox";

interface PastePreviewState {
  anchor: Point;
}

interface UseClipboardWorkflowOptions {
  onCopySelection: () => void;
  onPreparePastePreview: () => void;
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
  viewBox: ViewBox;
}

export function useClipboardWorkflow({
  onCopySelection,
  onPreparePastePreview,
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
  viewBox,
}: UseClipboardWorkflowOptions) {
  const [selectionClipboard, setSelectionClipboard] =
    useState<SelectionClipboard | null>(null);
  const [pastePreview, setPastePreview] = useState<PastePreviewState | null>(null);
  const activePasteClipboard = pastePreview ? selectionClipboard : null;

  function clearPastePreview() {
    setPastePreview(null);
  }

  function copySelectedGraphElements() {
    const clipboard = clipboardFromSelection(project, selectedNodeIds);
    if (!clipboard) {
      setEngineStatus("Nothing selected to copy.");
      return;
    }

    setSelectionClipboard(clipboard);
    onCopySelection();
    setPastePreview(null);
    setEngineStatus(`Copied ${clipboard.nodes.length} node(s) to clipboard.`);
  }

  function startPastePreview() {
    if (!selectionClipboard) {
      setEngineStatus("Clipboard is empty.");
      return;
    }

    setMode("select");
    onPreparePastePreview();
    setPastePreview({
      anchor: {
        x: viewBox.x + viewBox.width / 2,
        y: viewBox.y + viewBox.height / 2,
      },
    });
    setEngineStatus(
      "Move the pointer to place the copied selection, click to paste or press Esc to cancel.",
    );
  }

  function updatePastePreviewAnchor(anchor: Point) {
    setPastePreview({ anchor });
  }

  function completePastePreview(anchor: Point) {
    if (!pastePreview || !selectionClipboard) {
      return;
    }

    const result = pasteSelectionClipboard(projectRef.current, selectionClipboard, anchor);
    recordProjectHistory(projectRef.current);
    setProjectState(result.project);
    setSelectedNodeIds(result.nodeIds);
    setSelectedNodeId(result.nodeIds[result.nodeIds.length - 1] ?? null);
    setSelectedEdgeId(null);
    onResetTransientInteractionState();
    setPastePreview(null);
    setOutput(null);
    setEngineStatus(`Pasted ${result.nodeIds.length} node(s).`);
  }

  function cancelPastePreview(message = "Paste cancelled.") {
    if (!pastePreview) {
      return;
    }
    setPastePreview(null);
    setEngineStatus(message);
  }

  return {
    activePasteClipboard,
    cancelPastePreview,
    clearPastePreview,
    completePastePreview,
    copySelectedGraphElements,
    pastePreview,
    setSelectionClipboard,
    startPastePreview,
    updatePastePreviewAnchor,
  };
}
