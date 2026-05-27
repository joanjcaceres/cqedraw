import type {
  Dispatch,
  PointerEvent,
  SetStateAction,
} from "react";

import {
  addEdge,
  addNode,
  moveGroundEdge,
  toggleGround,
} from "./graph";
import {
  projectsMatch,
  selectionStatusMessage,
} from "./projectState";
import type {
  CircuitEdge,
  CircuitProject,
  ToolMode,
} from "./types";
import {
  clampNodeDragDeltaToView,
  moveDraggedNodes,
  nodeIdsInsideRect,
  rectFromPoints,
  svgPoint,
  svgPointFromClient,
  type NodeDragPosition,
  type Point,
  type ViewBox,
} from "./viewBox";

export interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewBox: ViewBox;
}

export interface NodeDragState {
  pointerId: number;
  startProject: CircuitProject;
  startPoint: Point;
  nodePositions: NodeDragPosition[];
}

export interface GroundDragState {
  pointerId: number;
  edgeId: number;
  startProject: CircuitProject;
  startPoint: Point;
  startOffset: Point;
}

export interface MarqueeState {
  pointerId: number;
  start: Point;
  current: Point;
}

interface UseCanvasInteractionHandlersOptions {
  cancelPastePreview: () => void;
  clearNodeSelection: () => void;
  clearPastePreview: () => void;
  commitProjectChange: (
    updateProject: (current: CircuitProject) => CircuitProject,
  ) => void;
  completePastePreview: (anchor: Point) => void;
  groundDragState: GroundDragState | null;
  marqueeState: MarqueeState | null;
  mode: ToolMode;
  nodeDragState: NodeDragState | null;
  panState: PanState | null;
  pastePreviewActive: boolean;
  pendingEdgeNodeId: number | null;
  project: CircuitProject;
  projectRef: { current: CircuitProject };
  recordProjectHistory: (project: CircuitProject) => void;
  selectedEdgeId: number | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  setEngineStatus: (message: string) => void;
  setGroundDragState: Dispatch<SetStateAction<GroundDragState | null>>;
  setInlineValueEditorEdgeId: (edgeId: number | null) => void;
  setMarqueeState: Dispatch<SetStateAction<MarqueeState | null>>;
  setNodeDragState: Dispatch<SetStateAction<NodeDragState | null>>;
  setOutput: (output: null) => void;
  setPanState: Dispatch<SetStateAction<PanState | null>>;
  setPendingEdgeNodeId: Dispatch<SetStateAction<number | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<number | null>>;
  setSelectedNodeId: Dispatch<SetStateAction<number | null>>;
  setSelectedNodeIds: Dispatch<SetStateAction<number[]>>;
  setViewBox: (viewBox: ViewBox) => void;
  updatePastePreviewAnchor: (anchor: Point) => void;
  updateProjectState: (
    updateProject: (current: CircuitProject) => CircuitProject,
  ) => void;
  viewBox: ViewBox;
}

export function useCanvasInteractionHandlers({
  cancelPastePreview,
  clearNodeSelection,
  clearPastePreview,
  commitProjectChange,
  completePastePreview,
  groundDragState,
  marqueeState,
  mode,
  nodeDragState,
  panState,
  pastePreviewActive,
  pendingEdgeNodeId,
  project,
  projectRef,
  recordProjectHistory,
  selectedEdgeId,
  selectedNodeId,
  selectedNodeIds,
  setEngineStatus,
  setGroundDragState,
  setInlineValueEditorEdgeId,
  setMarqueeState,
  setNodeDragState,
  setOutput,
  setPanState,
  setPendingEdgeNodeId,
  setSelectedEdgeId,
  setSelectedNodeId,
  setSelectedNodeIds,
  setViewBox,
  updatePastePreviewAnchor,
  updateProjectState,
  viewBox,
}: UseCanvasInteractionHandlersOptions) {
  function recordCompletedNodeDrag(dragState: NodeDragState | null) {
    if (!dragState || projectsMatch(dragState.startProject, projectRef.current)) {
      return;
    }
    recordProjectHistory(dragState.startProject);
    setOutput(null);
  }

  function recordCompletedGroundDrag(dragState: GroundDragState | null) {
    if (!dragState || projectsMatch(dragState.startProject, projectRef.current)) {
      return;
    }
    recordProjectHistory(dragState.startProject);
    setOutput(null);
  }

  function selectSingleNode(nodeId: number) {
    setSelectedNodeIds([nodeId]);
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setInlineValueEditorEdgeId(null);
    setEngineStatus(selectionStatusMessage(1));
  }

  function toggleNodeSelection(nodeId: number) {
    setSelectedEdgeId(null);
    setInlineValueEditorEdgeId(null);
    const isSelected = selectedNodeIds.includes(nodeId);
    const next = isSelected
      ? selectedNodeIds.filter((id) => id !== nodeId)
      : [...selectedNodeIds, nodeId];

    setSelectedNodeIds(next);
    if (isSelected) {
      setSelectedNodeId((focused) =>
        focused === nodeId ? next[next.length - 1] ?? null : focused,
      );
    } else {
      setSelectedNodeId(nodeId);
    }
    setEngineStatus(selectionStatusMessage(next.length));
  }

  function handleCanvasPointerDown(event: PointerEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    const hadSelection =
      selectedNodeIds.length > 0 ||
      selectedNodeId !== null ||
      selectedEdgeId !== null;
    if (pastePreviewActive) {
      completePastePreview(point);
      return;
    }

    if (mode === "node") {
      commitProjectChange((current) => {
        const next = addNode(current, point.x, point.y);
        const id = next.state.node_counter - 1;
        setSelectedNodeIds([id]);
        setSelectedNodeId(id);
        setSelectedEdgeId(null);
        setInlineValueEditorEdgeId(null);
        return next;
      });
      setOutput(null);
      return;
    }
    if (mode === "select" || mode === "box-select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      if (mode === "box-select" || event.shiftKey) {
        setMarqueeState({
          pointerId: event.pointerId,
          start: point,
          current: point,
        });
        setPanState(null);
      } else {
        setPanState({
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startViewBox: viewBox,
        });
        setMarqueeState(null);
      }
    }
    clearNodeSelection();
    setSelectedEdgeId(null);
    setInlineValueEditorEdgeId(null);
    setPendingEdgeNodeId(null);
    setGroundDragState(null);
    if (hadSelection) {
      setEngineStatus(selectionStatusMessage(0));
    }
  }

  function handleNodePointerDown(
    event: PointerEvent<SVGCircleElement>,
    nodeId: number,
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarqueeState(null);
    setGroundDragState(null);

    if (pastePreviewActive) {
      const svg = event.currentTarget.ownerSVGElement;
      if (svg) {
        completePastePreview(svgPointFromClient(svg, event.clientX, event.clientY));
      }
      return;
    }

    if (mode === "edge") {
      if (pendingEdgeNodeId === null) {
        setPendingEdgeNodeId(nodeId);
      } else {
        commitProjectChange((current) => {
          const before = current.state.edge_counter;
          const next = addEdge(current, pendingEdgeNodeId, nodeId);
          if (next.state.edge_counter > before) {
            setSelectedEdgeId(before);
            setInlineValueEditorEdgeId(before);
            clearNodeSelection();
            setEngineStatus("Added connection. Enter C/L/LJ values.");
          } else {
            setSelectedEdgeId(null);
            setInlineValueEditorEdgeId(null);
            selectSingleNode(nodeId);
            setEngineStatus("A connection between those nodes already exists.");
          }
          return next;
        });
        setPendingEdgeNodeId(null);
        setOutput(null);
      }
      return;
    }

    if (mode === "ground") {
      const existing = projectRef.current.state.edges.find(
        (edge) => edge.is_ground && edge.nodes[0] === nodeId,
      );
      if (existing) {
        clearNodeSelection();
        setSelectedEdgeId(existing.identifier);
        setInlineValueEditorEdgeId(existing.identifier);
        setPendingEdgeNodeId(null);
        setPanState(null);
        setMarqueeState(null);
        setGroundDragState(null);
        setEngineStatus("Selected existing ground connection. Enter C/L/LJ values.");
        return;
      }

      commitProjectChange((current) => {
        const next = toggleGround(current, nodeId);
        clearNodeSelection();
        setSelectedEdgeId(current.state.edge_counter);
        setInlineValueEditorEdgeId(current.state.edge_counter);
        return next;
      });
      setOutput(null);
      setEngineStatus("Added ground connection.");
      return;
    }

    const isSelectionMode = mode === "select" || mode === "box-select";

    if (isSelectionMode && event.shiftKey) {
      toggleNodeSelection(nodeId);
      setNodeDragState(null);
      setPanState(null);
      return;
    }

    const isDraggingExistingSelection =
      isSelectionMode &&
      selectedNodeIds.length > 1 &&
      selectedNodeIds.includes(nodeId);
    const dragNodeIds = isDraggingExistingSelection ? selectedNodeIds : [nodeId];

    if (!isDraggingExistingSelection) {
      selectSingleNode(nodeId);
    }
    startNodeDrag(event, dragNodeIds);
    setPanState(null);
  }

  function startNodeDrag(
    event: PointerEvent<SVGCircleElement>,
    nodeIds: number[],
  ) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) {
      setNodeDragState(null);
      return;
    }

    const dragNodeIds = new Set(nodeIds);
    const nodePositions = project.state.nodes
      .filter((node) => dragNodeIds.has(node.identifier))
      .map((node) => ({
        identifier: node.identifier,
        x: node.x,
        y: node.y,
      }));
    if (nodePositions.length === 0) {
      setNodeDragState(null);
      return;
    }

    setNodeDragState({
      pointerId: event.pointerId,
      startProject: project,
      startPoint: svgPointFromClient(svg, event.clientX, event.clientY),
      nodePositions,
    });
  }

  function startGroundDrag(
    event: PointerEvent<SVGGElement>,
    edge: CircuitEdge,
  ) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) {
      setGroundDragState(null);
      return;
    }

    setGroundDragState({
      pointerId: event.pointerId,
      edgeId: edge.identifier,
      startProject: projectRef.current,
      startPoint: svgPointFromClient(svg, event.clientX, event.clientY),
      startOffset: {
        x: edge.ground_offset_x,
        y: edge.ground_offset_y,
      },
    });
  }

  function handleCanvasPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (pastePreviewActive) {
      updatePastePreviewAnchor(svgPoint(event));
      return;
    }

    if (
      marqueeState &&
      marqueeState.pointerId === event.pointerId &&
      (mode === "select" || mode === "box-select")
    ) {
      const current = svgPoint(event);
      setMarqueeState((state) =>
        state?.pointerId === event.pointerId ? { ...state, current } : state,
      );
      return;
    }

    if (
      groundDragState &&
      groundDragState.pointerId === event.pointerId &&
      (mode === "select" || mode === "box-select")
    ) {
      const point = svgPoint(event);
      const nextOffset = {
        x: groundDragState.startOffset.x + point.x - groundDragState.startPoint.x,
        y: groundDragState.startOffset.y + point.y - groundDragState.startPoint.y,
      };
      updateProjectState((current) =>
        moveGroundEdge(
          current,
          groundDragState.edgeId,
          nextOffset.x,
          nextOffset.y,
        ),
      );
      return;
    }

    if (
      nodeDragState &&
      nodeDragState.pointerId === event.pointerId &&
      mode !== "edge" &&
      mode !== "ground"
    ) {
      const point = svgPoint(event);
      const delta = clampNodeDragDeltaToView(
        nodeDragState.nodePositions,
        point.x - nodeDragState.startPoint.x,
        point.y - nodeDragState.startPoint.y,
        viewBox,
      );
      updateProjectState((current) =>
        moveDraggedNodes(
          current,
          nodeDragState.nodePositions,
          delta.x,
          delta.y,
        ),
      );
      return;
    }

    if (panState && panState.pointerId === event.pointerId && mode === "select") {
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = ((event.clientX - panState.startClientX) / rect.width) * panState.startViewBox.width;
      const dy =
        ((event.clientY - panState.startClientY) / rect.height) * panState.startViewBox.height;
      setViewBox({
        ...panState.startViewBox,
        x: panState.startViewBox.x - dx,
        y: panState.startViewBox.y - dy,
      });
      return;
    }
  }

  function handleCanvasPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (
      marqueeState &&
      marqueeState.pointerId === event.pointerId &&
      (mode === "select" || mode === "box-select")
    ) {
      const selectionRect = rectFromPoints(marqueeState.start, svgPoint(event));
      const selectedIds = nodeIdsInsideRect(project.state.nodes, selectionRect);
      setSelectedNodeIds(selectedIds);
      setSelectedNodeId(selectedIds[selectedIds.length - 1] ?? null);
      setSelectedEdgeId(null);
      setInlineValueEditorEdgeId(null);
      setPendingEdgeNodeId(null);
      setMarqueeState(null);
      setPanState(null);
      setNodeDragState(null);
      setGroundDragState(null);
      setEngineStatus(
        selectionStatusMessage(selectedIds.length),
      );
      return;
    }

    if (nodeDragState && nodeDragState.pointerId === event.pointerId) {
      recordCompletedNodeDrag(nodeDragState);
    }
    if (groundDragState && groundDragState.pointerId === event.pointerId) {
      recordCompletedGroundDrag(groundDragState);
    }
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
  }

  function handleCanvasPointerCancel() {
    recordCompletedNodeDrag(nodeDragState);
    recordCompletedGroundDrag(groundDragState);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    cancelPastePreview();
  }

  function handleEdgePointerDown(event: PointerEvent<SVGElement>, edgeId: number) {
    event.stopPropagation();
    if (pastePreviewActive) {
      const svg = event.currentTarget.ownerSVGElement;
      if (svg) {
        completePastePreview(svgPointFromClient(svg, event.clientX, event.clientY));
      }
      return;
    }

    const edge = project.state.edges.find(
      (candidate) => candidate.identifier === edgeId,
    );
    setSelectedEdgeId(edgeId);
    setInlineValueEditorEdgeId(edgeId);
    clearNodeSelection();
    setPendingEdgeNodeId(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    clearPastePreview();
    setEngineStatus(
      edge?.is_ground
        ? "Selected ground connection. Enter C/L/LJ values."
        : "Selected connection. Enter C/L/LJ values.",
    );
  }

  function handleGroundPointerDown(
    event: PointerEvent<SVGGElement>,
    edgeId: number,
  ) {
    event.stopPropagation();
    if (pastePreviewActive) {
      const svg = event.currentTarget.ownerSVGElement;
      if (svg) {
        completePastePreview(svgPointFromClient(svg, event.clientX, event.clientY));
      }
      return;
    }

    const edge = projectRef.current.state.edges.find(
      (candidate) => candidate.identifier === edgeId && candidate.is_ground,
    );
    if (!edge) {
      return;
    }

    setSelectedEdgeId(edgeId);
    setInlineValueEditorEdgeId(null);
    clearNodeSelection();
    setPendingEdgeNodeId(null);
    setPanState(null);
    setMarqueeState(null);
    clearPastePreview();
    setEngineStatus("Selected ground connection.");
    if (mode === "select" || mode === "box-select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      startGroundDrag(event, edge);
    } else {
      setGroundDragState(null);
    }
  }

  return {
    handleCanvasPointerCancel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleEdgePointerDown,
    handleGroundPointerDown,
    handleNodePointerDown,
  };
}
