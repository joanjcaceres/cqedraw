import { useEffect, type RefObject } from "react";

import { shouldIgnoreAppShortcut } from "./projectState";
import type { ToolMode } from "./types";
import { ZOOM_IN_FACTOR, ZOOM_OUT_FACTOR } from "./viewBox";

export function useAppShortcuts({
  copySelectedGraphElements,
  deleteSelection,
  dialogOpen,
  fileInputRef,
  fitCanvasView,
  generateOutput,
  mergeSelectedNodes,
  openConcatenateDialog,
  pastePreviewActive,
  pendingEdgeNodeId,
  redoProjectChange,
  saveProject,
  selectedEdgeId,
  selectedNodeCount,
  selectedNodeId,
  setEngineStatus,
  setModeAndReset,
  startPastePreview,
  undoProjectChange,
  zoomCanvas,
}: {
  copySelectedGraphElements: () => void;
  deleteSelection: () => void;
  dialogOpen: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  fitCanvasView: () => void;
  generateOutput: () => void;
  mergeSelectedNodes: () => void;
  openConcatenateDialog: () => void;
  pastePreviewActive: boolean;
  pendingEdgeNodeId: number | null;
  redoProjectChange: () => void;
  saveProject: () => void;
  selectedEdgeId: number | null;
  selectedNodeCount: number;
  selectedNodeId: number | null;
  setEngineStatus: (message: string) => void;
  setModeAndReset: (mode: ToolMode) => void;
  startPastePreview: () => void;
  undoProjectChange: () => void;
  zoomCanvas: (factor: number) => void;
}) {
  useEffect(() => {
    function handleAppKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        shouldIgnoreAppShortcut(event.target, dialogOpen)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasSystemModifier = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        event.preventDefault();
        if (!pastePreviewActive && pendingEdgeNodeId !== null) {
          setEngineStatus("Edge cancelled.");
        }
        setModeAndReset("select");
        return;
      }

      if (hasSystemModifier && !event.altKey) {
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            redoProjectChange();
          } else {
            undoProjectChange();
          }
          return;
        }

        if (key === "y") {
          event.preventDefault();
          redoProjectChange();
          return;
        }

        if (key === "c" && !event.shiftKey) {
          event.preventDefault();
          copySelectedGraphElements();
          return;
        }

        if (key === "v" && !event.shiftKey) {
          event.preventDefault();
          startPastePreview();
          return;
        }

        if (key === "s" && !event.shiftKey) {
          event.preventDefault();
          saveProject();
          return;
        }

        if (key === "o" && !event.shiftKey) {
          event.preventDefault();
          fileInputRef.current?.click();
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          generateOutput();
        }
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (key === "+" || key === "=") {
        event.preventDefault();
        zoomCanvas(ZOOM_IN_FACTOR);
        return;
      }
      if (key === "-") {
        event.preventDefault();
        zoomCanvas(ZOOM_OUT_FACTOR);
        return;
      }
      if (key === "0") {
        event.preventDefault();
        fitCanvasView();
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        (selectedEdgeId !== null || selectedNodeId !== null || selectedNodeCount > 0)
      ) {
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (event.shiftKey) {
        return;
      }

      if (key === "m") {
        mergeSelectedNodes();
        return;
      }
      if (key === "d") {
        event.preventDefault();
        openConcatenateDialog();
        return;
      }
      if (key === "v") {
        setModeAndReset("select");
        return;
      }
      if (key === "b") {
        setModeAndReset("box-select");
        return;
      }
      if (key === "n") {
        setModeAndReset("node");
        return;
      }
      if (key === "e") {
        setModeAndReset("edge");
        return;
      }
      if (key === "g") {
        setModeAndReset("ground");
      }
    }

    window.addEventListener("keydown", handleAppKeyDown);
    return () => window.removeEventListener("keydown", handleAppKeyDown);
  });
}
