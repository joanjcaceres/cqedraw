import {
  PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addEdge,
  addNode,
  moveGroundEdge,
  renameNode,
  toggleGround,
  updateEdgeValues,
} from "./graph";
import {
  buildParameterInputSpecs,
  convertAnalysisParameterValues,
  type ParameterInputMode,
} from "./parameterUnits";
import {
  CircuitEdge,
  CircuitNode,
  CircuitProject,
  GROUND_NODE_ID,
  ModalAnalysisResult,
  OutputResult,
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
import {
  projectsMatch,
  selectionStatusMessage,
} from "./projectState";
import {
  missingParameterNames,
} from "./sweepState";
import {
  ConcatenateDialog,
  HelpDialog,
  NewProjectDialog,
  TutorialResetDialog,
} from "./AppDialogs";
import { AppToolbar } from "./AppToolbar";
import { CircuitCanvas } from "./CircuitCanvas";
import {
  matrixNodeLabelMap,
} from "./CircuitEdgeShape";
import { InspectorPanel } from "./InspectorPanel";
import { OutputDrawer } from "./OutputDrawer";
import { TutorialOverlay } from "./TutorialOverlay";
import { useAppShortcuts } from "./useAppShortcuts";
import { useCanvasViewport } from "./useCanvasViewport";
import { useClipboardWorkflow } from "./useClipboardWorkflow";
import { useConcatenateWorkflow } from "./useConcatenateWorkflow";
import { useEngineWarmup } from "./useEngineWarmup";
import { useInlineEdgeEditor } from "./useInlineEdgeEditor";
import {
  COPY_MATRICES_STATUS,
  useModalAnalysisActions,
} from "./useModalAnalysisActions";
import { useOutputGeneration } from "./useOutputGeneration";
import { useOutputPanelScroll } from "./useOutputPanelScroll";
import { useProjectHistory } from "./useProjectHistory";
import { useProjectLifecycle } from "./useProjectLifecycle";
import { useSelectionActions } from "./useSelectionActions";
import { useSweepAnalysis } from "./useSweepAnalysis";
import { useTutorialState } from "./useTutorialState";

const OUTPUT_GENERATION_DEBOUNCE_MS = 250;

interface PanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewBox: ViewBox;
}

interface NodeDragState {
  pointerId: number;
  startProject: CircuitProject;
  startPoint: Point;
  nodePositions: NodeDragPosition[];
}

interface GroundDragState {
  pointerId: number;
  edgeId: number;
  startProject: CircuitProject;
  startPoint: Point;
  startOffset: Point;
}

interface MarqueeState {
  pointerId: number;
  start: Point;
  current: Point;
}

export function App() {
  const [mode, setMode] = useState<ToolMode>("node");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [pendingEdgeNodeId, setPendingEdgeNodeId] = useState<number | null>(null);
  const [nodeDragState, setNodeDragState] = useState<NodeDragState | null>(null);
  const [groundDragState, setGroundDragState] = useState<GroundDragState | null>(
    null,
  );
  const [panState, setPanState] = useState<PanState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [output, setOutput] = useState<OutputResult | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [parameterInputModes, setParameterInputModes] = useState<
    Record<string, ParameterInputMode>
  >({});
  const [modalAnalysis, setModalAnalysis] = useState<ModalAnalysisResult | null>(
    null,
  );
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [outputDrawerOpen, setOutputDrawerOpen] = useState(false);
  const [engineStatus, setEngineStatus] = useState("Ready.");
  const { clientRef, engineWarmup, setEngineWarmup } = useEngineWarmup();
  const [snippetCopied, setSnippetCopied] = useState(false);
  const {
    canRedo,
    canUndo,
    commitProjectChange,
    hasUnsavedChanges,
    markProjectClean,
    project,
    projectRef,
    recordProjectHistory,
    redoProjectChange,
    resetProjectHistory,
    setProjectState,
    undoProjectChange,
    updateProjectState,
  } = useProjectHistory({
    onProjectRestored: (message) => {
      resetProjectInteractionState();
      setOutput(null);
      setEngineStatus(message);
    },
    onProjectStatus: setEngineStatus,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectButtonRef = useRef<HTMLButtonElement | null>(null);
  const nodeButtonRef = useRef<HTMLButtonElement | null>(null);
  const concatenateButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const analysisRequestIdRef = useRef(0);
  const dismissTutorialResetRef = useRef<() => void>(() => {});
  const prepareTutorialGenerateStep = useCallback(() => {
    setMode("select");
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
  }, []);
  const resetCanvasWheelState = useCallback(() => {
    setPanState(null);
    setMarqueeState(null);
    setGroundDragState(null);
  }, []);
  const resetTransientInteractionState = useCallback(() => {
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
  }, []);
  const {
    canvasRef,
    canvasStageRef,
    fitCanvasView,
    setViewBox,
    viewBox,
    zoomCanvas,
  } = useCanvasViewport({
    onWheelZoomStart: resetCanvasWheelState,
    project,
  });
  const {
    activePasteClipboard,
    cancelPastePreview,
    clearPastePreview,
    completePastePreview,
    copySelectedGraphElements,
    pastePreview,
    setSelectionClipboard,
    startPastePreview,
    updatePastePreviewAnchor,
  } = useClipboardWorkflow({
    onCopySelection: () => {
      setGroundDragState(null);
    },
    onPreparePastePreview: () => {
      setPendingEdgeNodeId(null);
      setNodeDragState(null);
      setGroundDragState(null);
      setPanState(null);
      setMarqueeState(null);
    },
    onResetTransientInteractionState: resetTransientInteractionState,
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
  });

  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    }
  }, []);

  const selectedNode = useMemo(
    () =>
      selectedNodeIds.length === 1
        ? project.state.nodes.find((node) => node.identifier === selectedNodeIds[0]) ?? null
        : null,
    [project, selectedNodeIds],
  );
  const selectedEdge = useMemo(
    () => project.state.edges.find((edge) => edge.identifier === selectedEdgeId) ?? null,
    [project, selectedEdgeId],
  );
  const matrixNodeLabels = useMemo(
    () => matrixNodeLabelMap(project.state.nodes),
    [project.state.nodes],
  );
  const {
    inlineCapInputRef,
    inlineValueEditorEdge,
    inlineValueEditorEdgeId,
    inlineValueEditorPosition,
    inlineValueEditorRef,
    setInlineValueEditorEdgeId,
  } = useInlineEdgeEditor({
    canvasRef,
    canvasStageRef,
    project,
    projectRef,
    selectedEdge,
    selectedEdgeId,
    viewBox,
  });
  const {
    closeHelp,
    dismissTutorial,
    finishTutorial,
    helpOpen,
    setHelpOpen,
    setTutorialCopied,
    setTutorialPromptOpen,
    setTutorialStep,
    tutorialCopied,
    tutorialPromptOpen,
    tutorialStep,
  } = useTutorialState({
    dismissTutorialResetRef,
    helpButtonRef,
    mode,
    onPrepareGenerateStep: prepareTutorialGenerateStep,
    output,
    project,
    selectedEdgeId,
    setOutputDrawerOpen,
  });
  const {
    concatenateAnalysis,
    concatenateDialogOpen,
    concatenatePreviewBridges,
    closeConcatenateDialog,
    concatenatePortPairsForPortCount,
    concatenateSelectedGraphElements,
    openConcatenateDialog,
    setConcatenatePreviewPairs,
  } = useConcatenateWorkflow({
    concatenateButtonRef,
    onResetTransientInteractionState: () => {
      resetTransientInteractionState();
      clearPastePreview();
    },
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
  });
  const hasProjectContent =
    project.state.nodes.length > 0 || project.state.edges.length > 0;
  const canStartNewProject =
    hasProjectContent || hasUnsavedChanges || output !== null || canUndo || canRedo;
  const {
    beginTutorial,
    closeNewProjectDialog,
    closeTutorialReset,
    confirmNewProject,
    confirmTutorialReset,
    dismissTutorialReset,
    loadProject,
    newProjectDialogOpen,
    requestNewProject,
    requestTutorialStart,
    saveProject,
    tutorialResetOpen,
  } = useProjectLifecycle({
    canStartNewProject,
    hasProjectContent,
    hasUnsavedChanges,
    helpButtonRef,
    markProjectClean,
    newProjectButtonRef,
    nodeButtonRef,
    project,
    resetLoadedProjectInteractionState,
    resetProjectHistory,
    resetProjectInteractionState,
    resetTutorialProjectInteractionState,
    setEngineStatus,
    setHelpOpen,
    setMode,
    setOutput,
    setOutputDrawerOpen,
    setProjectState,
    setSelectionClipboard,
    setTutorialCopied,
    setTutorialPromptOpen,
    setTutorialStep,
    setViewBox,
  });
  dismissTutorialResetRef.current = dismissTutorialReset;
  const hasGeneratedSnippet = Boolean(output?.snippet);
  const statusIsCopyConfirmation = engineStatus === COPY_MATRICES_STATUS;
  const outputParameters = useMemo(() => output?.parameters ?? [], [output]);
  const parameterInputSpecs = useMemo(
    () => buildParameterInputSpecs(output, project.state.edges),
    [output, project.state.edges],
  );
  const {
    activeParameterInputValues,
    activeSweepParameters,
    cachedSweepGridPointCount,
    clearSweepResults,
    markSweepSliderInteraction,
    missingSweepFixedValues,
    resetSweepConfigForParameter,
    selectedSweepSample,
    setSweepSliderValue,
    sweepConfig,
    sweepError,
    sweepModeActive,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
    sweepSliderValues,
    sweepValidation,
    updateSweepConfig,
  } = useSweepAnalysis({
    clientRef,
    output,
    outputParameters,
    parameterInputModes,
    parameterInputSpecs,
    parameterValues,
    projectRef,
    setEngineStatus,
    setEngineWarmup,
  });
  const { generateOutput, runGenerateOutput } = useOutputGeneration({
    analysisRequestIdRef,
    clearSweepResults,
    clientRef,
    engineWarmup,
    project,
    setAnalysisRunning,
    setEngineStatus,
    setEngineWarmup,
    setModalAnalysis,
    setOutput,
    setOutputDrawerOpen,
    setSnippetCopied,
  });

  useEffect(() => {
    if (!outputDrawerOpen || output || !hasProjectContent) {
      return;
    }

    const timer = window.setTimeout(() => {
      void runGenerateOutput();
    }, OUTPUT_GENERATION_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [hasProjectContent, output, outputDrawerOpen, project]);

  const missingParameterValues = useMemo(
    () => missingParameterNames(outputParameters, parameterValues),
    [outputParameters, parameterValues],
  );
  const parameterInputError = useMemo(
    () =>
      convertAnalysisParameterValues(
        outputParameters,
        activeParameterInputValues,
        parameterInputModes,
        parameterInputSpecs,
      ).error,
    [
      activeParameterInputValues,
      outputParameters,
      parameterInputModes,
      parameterInputSpecs,
    ],
  );
  const displayedAnalysis = sweepModeActive
    ? selectedSweepSample?.analysis ?? null
    : modalAnalysis;
  const { outputPanelRef, preserveOutputPanelScroll } = useOutputPanelScroll([
    displayedAnalysis,
    engineStatus,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
  ]);
  useEffect(() => {
    if (!output) {
      analysisRequestIdRef.current += 1;
      setModalAnalysis(null);
      setAnalysisRunning(false);
      setParameterInputModes({});
      clearSweepResults();
      return;
    }
    setParameterValues((current) => {
      const next: Record<string, string> = {};
      for (const name of outputParameters) {
        next[name] = current[name] ?? "";
      }
      return next;
    });
    setParameterInputModes((current) => {
      const next: Record<string, ParameterInputMode> = {};
      for (const name of outputParameters) {
        const currentMode = current[name] ?? "physical";
        next[name] =
          currentMode === "energy" && parameterInputSpecs[name]?.kind
            ? "energy"
            : "physical";
      }
      return next;
    });
  }, [output, outputParameters, parameterInputSpecs]);
  const {
    copySnippet,
    exportAnalysisCsv,
    runModalAnalysis,
    updateParameterInputMode,
    updateParameterValue,
  } = useModalAnalysisActions({
    activeSweepParameterCount: activeSweepParameters.length,
    analysisRequestIdRef,
    clearSweepResults,
    clientRef,
    engineWarmup,
    missingParameterValueCount: missingParameterValues.length,
    modalAnalysis,
    output,
    outputParameters,
    parameterInputError,
    parameterInputModes,
    parameterInputSpecs,
    parameterValues,
    preserveOutputPanelScroll,
    project,
    projectRef,
    resetSweepConfigForParameter,
    runGenerateOutput,
    setAnalysisRunning,
    setEngineStatus,
    setEngineWarmup,
    setModalAnalysis,
    setOutputDrawerOpen,
    setParameterInputModes,
    setParameterValues,
    setSnippetCopied,
    setTutorialCopied,
  });

  function setModeAndReset(nextMode: ToolMode) {
    if (pastePreview) {
      cancelPastePreview();
    }
    setMode(nextMode);
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    setInlineValueEditorEdgeId(null);
  }

  function updateEdgeValueText(
    edgeId: number,
    values: {
      capacitanceText?: string | null;
      inductanceText?: string | null;
      josephsonInductanceText?: string | null;
      josephsonPhaseSign?: 1 | -1;
    },
  ) {
    commitProjectChange((current) => updateEdgeValues(current, edgeId, values));
    setOutput(null);
    clearSweepResults();
  }

  function resetProjectInteractionState() {
    setSelectedNodeIds([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    clearPastePreview();
    setInlineValueEditorEdgeId(null);
  }

  function resetLoadedProjectInteractionState() {
    setSelectedEdgeId(null);
    clearNodeSelection();
    setPendingEdgeNodeId(null);
    setPanState(null);
    setMarqueeState(null);
    clearPastePreview();
  }

  function resetTutorialProjectInteractionState() {
    clearNodeSelection();
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    clearPastePreview();
  }
  const { deleteSelection, mergeSelectedNodes } = useSelectionActions({
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
  });

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

  function clearNodeSelection() {
    setSelectedNodeIds([]);
    setSelectedNodeId(null);
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
    if (pastePreview) {
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

    if (pastePreview) {
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
    if (pastePreview) {
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
    if (pastePreview) {
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
    if (pastePreview) {
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

  useAppShortcuts({
    copySelectedGraphElements,
    deleteSelection,
    dialogOpen:
      helpOpen ||
      tutorialResetOpen ||
      concatenateDialogOpen ||
      newProjectDialogOpen,
    fileInputRef,
    fitCanvasView,
    generateOutput,
    mergeSelectedNodes,
    openConcatenateDialog,
    pastePreviewActive: Boolean(pastePreview),
    pendingEdgeNodeId,
    redoProjectChange,
    saveProject,
    selectedEdgeId,
    selectedNodeCount: selectedNodeIds.length,
    selectedNodeId,
    setEngineStatus,
    setModeAndReset,
    startPastePreview,
    undoProjectChange,
    zoomCanvas,
  });

  const selectedEdgeLabel = selectedEdge
    ? selectedEdge.is_ground
      ? `Ground ${matrixNodeLabels.get(selectedEdge.nodes[0]) ?? selectedEdge.nodes[0]}`
      : `${matrixNodeLabels.get(selectedEdge.nodes[0]) ?? selectedEdge.nodes[0]}-${
          matrixNodeLabels.get(selectedEdge.nodes[1]) ?? selectedEdge.nodes[1]
        }`
    : null;
  const mergeTargetNode =
    selectedNodeIds.length > 1 && selectedNodeId !== null
      ? project.state.nodes.find((node) => node.identifier === selectedNodeId) ?? null
      : null;
  const mergeTargetLabel = mergeTargetNode?.name ?? "selected node";
  const marqueeRect = marqueeState
    ? rectFromPoints(marqueeState.start, marqueeState.current)
    : null;

  return (
    <main className="app-shell">
      <AppToolbar
        canRedo={canRedo}
        canStartNewProject={canStartNewProject}
        canUndo={canUndo}
        concatenateButtonRef={concatenateButtonRef}
        fileInputRef={fileInputRef}
        hasUnsavedChanges={hasUnsavedChanges}
        helpButtonRef={helpButtonRef}
        mode={mode}
        newProjectButtonRef={newProjectButtonRef}
        nodeButtonRef={nodeButtonRef}
        onCopySelection={copySelectedGraphElements}
        onDeleteSelection={deleteSelection}
        onHelpOpen={() => setHelpOpen(true)}
        onLoadProject={(file) => void loadProject(file)}
        onMergeSelectedNodes={mergeSelectedNodes}
        onNewProject={requestNewProject}
        onOpenConcatenateDialog={openConcatenateDialog}
        onOutputToggle={() => setOutputDrawerOpen((open) => !open)}
        onPaste={startPastePreview}
        onRedo={redoProjectChange}
        onSaveProject={saveProject}
        onSetMode={setModeAndReset}
        onUndo={undoProjectChange}
        outputDrawerOpen={outputDrawerOpen}
        selectedNodeCount={selectedNodeIds.length}
        tutorialStep={tutorialStep}
      />

      <section className="workspace">
        <CircuitCanvas
          canvasRef={canvasRef}
          canvasStageRef={canvasStageRef}
          concatenatePreviewBridges={concatenatePreviewBridges}
          engineStatus={engineStatus}
          fitCanvasView={fitCanvasView}
          handleCanvasPointerCancel={handleCanvasPointerCancel}
          handleCanvasPointerDown={handleCanvasPointerDown}
          handleCanvasPointerMove={handleCanvasPointerMove}
          handleCanvasPointerUp={handleCanvasPointerUp}
          handleEdgePointerDown={handleEdgePointerDown}
          handleGroundPointerDown={handleGroundPointerDown}
          handleNodePointerDown={handleNodePointerDown}
          inlineCapInputRef={inlineCapInputRef}
          inlineValueEditorEdge={inlineValueEditorEdge}
          inlineValueEditorPosition={inlineValueEditorPosition}
          inlineValueEditorRef={inlineValueEditorRef}
          marqueeActive={Boolean(marqueeState)}
          marqueeRect={marqueeRect}
          matrixNodeLabels={matrixNodeLabels}
          mode={mode}
          onCloseInlineValueEditor={() => setInlineValueEditorEdgeId(null)}
          pastePreview={pastePreview}
          pastePreviewClipboard={activePasteClipboard}
          panActive={Boolean(panState)}
          pendingEdgeNodeId={pendingEdgeNodeId}
          project={project}
          selectedEdgeId={selectedEdgeId}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          statusIsCopyConfirmation={statusIsCopyConfirmation}
          tutorialSurfaceHighlighted={
            tutorialStep === "first-node" || tutorialStep === "second-node"
          }
          updateEdgeValueText={updateEdgeValueText}
          viewBox={viewBox}
          zoomCanvas={zoomCanvas}
        />

        <aside className="side-pane">
          <InspectorPanel
            edgeCount={project.state.edges.length}
            matrixNodeLabels={matrixNodeLabels}
            mergeTargetLabel={mergeTargetLabel}
            nodeCount={project.state.nodes.length}
            onCloseInlineValueEditor={() => setInlineValueEditorEdgeId(null)}
            onEdgeValueTextChange={updateEdgeValueText}
            onNodeNameChange={(nodeId, name) =>
              commitProjectChange((current) => renameNode(current, nodeId, name))
            }
            selectedEdge={selectedEdge}
            selectedEdgeLabel={selectedEdgeLabel}
            selectedNode={selectedNode}
            selectedNodeIds={selectedNodeIds}
            tutorialStep={tutorialStep}
          />
        </aside>
      </section>
      {outputDrawerOpen ? (
        <OutputDrawer
          activeSweepParameters={activeSweepParameters}
          analysisRunning={analysisRunning}
          cachedSweepGridPointCount={cachedSweepGridPointCount}
          displayedAnalysis={displayedAnalysis}
          hasGeneratedSnippet={hasGeneratedSnippet}
          hasProjectContent={hasProjectContent}
          missingParameterValues={missingParameterValues}
          missingSweepFixedValues={missingSweepFixedValues}
          onClose={() => setOutputDrawerOpen(false)}
          onCopySnippet={copySnippet}
          onExportAnalysisCsv={exportAnalysisCsv}
          onParameterInputModeChange={updateParameterInputMode}
          onParameterValueChange={updateParameterValue}
          onRunModalAnalysis={runModalAnalysis}
          onSweepConfigChange={updateSweepConfig}
          onSweepSliderChange={(name, value) => {
            markSweepSliderInteraction();
            preserveOutputPanelScroll();
            setSweepSliderValue(name, value);
          }}
          onSweepSliderInteraction={() => {
            markSweepSliderInteraction();
            preserveOutputPanelScroll();
          }}
          output={output}
          outputPanelRef={outputPanelRef}
          outputParameters={outputParameters}
          parameterInputError={parameterInputError}
          parameterInputModes={parameterInputModes}
          parameterInputSpecs={parameterInputSpecs}
          parameterValues={parameterValues}
          snippetCopied={snippetCopied}
          sweepConfig={sweepConfig}
          sweepError={sweepError}
          sweepModeActive={sweepModeActive}
          sweepPrecomputeRunning={sweepPrecomputeRunning}
          sweepRunning={sweepRunning}
          sweepSamples={sweepSamples}
          sweepSliderValues={sweepSliderValues}
          sweepValidation={sweepValidation}
          tutorialStep={tutorialStep}
        />
      ) : null}
      <TutorialOverlay
        nodeCount={project.state.nodes.length}
        onFinish={finishTutorial}
        onNext={() => setTutorialStep("first-node")}
        onSkip={dismissTutorial}
        onStart={beginTutorial}
        promptOpen={tutorialPromptOpen}
        step={tutorialStep}
      />
      {tutorialResetOpen ? (
        <TutorialResetDialog
          onCancel={closeTutorialReset}
          onConfirm={confirmTutorialReset}
        />
      ) : null}
      {newProjectDialogOpen ? (
        <NewProjectDialog
          onCancel={closeNewProjectDialog}
          onConfirm={confirmNewProject}
        />
      ) : null}
      {concatenateDialogOpen ? (
        <ConcatenateDialog
          analysis={concatenateAnalysis}
          onCancel={closeConcatenateDialog}
          onConfirm={concatenateSelectedGraphElements}
          onPortCountChange={concatenatePortPairsForPortCount}
          onPreviewChange={setConcatenatePreviewPairs}
        />
      ) : null}
      {helpOpen ? <HelpDialog onClose={closeHelp} onStartTutorial={requestTutorialStart} /> : null}
    </main>
  );
}
