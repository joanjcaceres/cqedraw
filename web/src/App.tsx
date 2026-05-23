import {
  Check,
  ClipboardCopy,
  ClipboardPaste,
  BoxSelect,
  Circle,
  CircleHelp,
  Copy,
  Download,
  SquarePlus,
  GitBranch,
  GripHorizontal,
  Maximize2,
  Merge,
  MousePointer2,
  Play,
  Redo2,
  Repeat2,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  KeyboardEvent,
  FormEvent,
  PointerEvent,
  ReactNode,
  Ref,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addEdge,
  addNode,
  analyzeConcatenateSelection,
  concatenatePortPairsForSelection,
  concatenatePreviewBridgesForSelection,
  concatenateSelection,
  emptyProject,
  mergeNodes,
  moveGroundEdge,
  normalizeProject,
  removeEdge,
  removeNode,
  renameNode,
  toggleGround,
  updateEdgeValues,
  type ConcatenatePortPair,
  type ConcatenatePreviewBridge,
  type ConcatenateSelectionAnalysis,
} from "./graph";
import { PyodideBridgeClient } from "./pyodideClient";
import {
  CircuitEdge,
  CircuitNode,
  CircuitProject,
  GROUND_NODE_ID,
  ModalAnalysisResult,
  OutputResult,
  ToolMode,
} from "./types";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 620;
const NODE_RADIUS = 11;
const TUTORIAL_STORAGE_KEY = "cqedraw.tutorial.v1";
const DEFAULT_VIEW_BOX: ViewBox = {
  x: 0,
  y: 0,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
};
const GRID_TILE_SIZE = 24;
const GRID_VIEW_MARGIN = GRID_TILE_SIZE * 2;
const MIN_VIEW_WIDTH = CANVAS_WIDTH / 4;
const MAX_VIEW_WIDTH = CANVAS_WIDTH * 20;
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
const FIT_VIEW_MARGIN = 96;
const WHEEL_ZOOM_SENSITIVITY = 0.001;
const WHEEL_DELTA_LIMIT = 600;
const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;
const PROJECT_HISTORY_LIMIT = 100;
const COPY_MATRICES_STATUS =
  "Copied matrices to clipboard. Paste them into Python or a notebook.";
const CAPACITOR_SYMBOL_HALF_LENGTH = 22;
const INDUCTOR_SYMBOL_HALF_LENGTH = 42;
const PARALLEL_LC_SYMBOL_HALF_LENGTH = 44;
const INLINE_EDGE_EDITOR_OFFSET = 62;
const INLINE_GROUND_EDITOR_OFFSET = 126;
const INLINE_EDITOR_ABOVE_THRESHOLD_PX = 96;

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

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

interface NodeDragPosition {
  identifier: number;
  x: number;
  y: number;
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

interface ClipboardNode {
  id: number;
  name: string;
  dx: number;
  dy: number;
}

type ClipboardEdge = Omit<CircuitEdge, "identifier">;

interface SelectionClipboard {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}

interface PastePreviewState {
  anchor: Point;
}

interface ProjectHistory {
  past: CircuitProject[];
  future: CircuitProject[];
}

type EdgeComponentKind =
  | "none"
  | "capacitor"
  | "inductor"
  | "josephson"
  | "parallel-lc"
  | "parallel-cj"
  | "parallel-lj"
  | "parallel-lcj";
type ParallelComponent = "capacitor" | "inductor" | "josephson";
type InlineEdgeEditorPlacement = "above" | "below";

interface InlineEdgeEditorPosition {
  leftPx: number;
  placement: InlineEdgeEditorPlacement;
  topPx: number;
}

type TutorialStep =
  | "welcome"
  | "first-node"
  | "second-node"
  | "edge-mode"
  | "connect-edge"
  | "edge-values"
  | "ground-mode"
  | "add-ground"
  | "ground-values"
  | "edit-edge"
  | "generate"
  | "copy"
  | "finish";
type TutorialPlacement = "canvas" | "tools" | "actions" | "inspector";
type WarmupPhase = "idle" | "warming" | "ready" | "error";

interface EngineWarmupState {
  base: WarmupPhase;
  analysis: WarmupPhase;
  error: string | null;
}

const INITIAL_ENGINE_WARMUP: EngineWarmupState = {
  base: "idle",
  analysis: "idle",
  error: null,
};

export function App() {
  const [project, setProject] = useState<CircuitProject>(() => emptyProject());
  const [cleanProjectSnapshot, setCleanProjectSnapshot] = useState(() =>
    serializeProjectForDirtyCheck(emptyProject()),
  );
  const [projectHistory, setProjectHistory] = useState<ProjectHistory>({
    past: [],
    future: [],
  });
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
  const [selectionClipboard, setSelectionClipboard] =
    useState<SelectionClipboard | null>(null);
  const [pastePreview, setPastePreview] = useState<PastePreviewState | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEW_BOX);
  const [output, setOutput] = useState<OutputResult | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [modalAnalysis, setModalAnalysis] = useState<ModalAnalysisResult | null>(
    null,
  );
  const [engineStatus, setEngineStatus] = useState("Ready.");
  const [engineWarmup, setEngineWarmup] = useState<EngineWarmupState>(
    INITIAL_ENGINE_WARMUP,
  );
  const [inlineValueEditorEdgeId, setInlineValueEditorEdgeId] =
    useState<number | null>(null);
  const [inlineValueEditorPosition, setInlineValueEditorPosition] =
    useState<InlineEdgeEditorPosition | null>(null);
  const [concatenatePreviewPairs, setConcatenatePreviewPairs] = useState<
    ConcatenatePortPair[]
  >([]);
  const [concatenateDialogOpen, setConcatenateDialogOpen] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialPromptOpen, setTutorialPromptOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null);
  const [tutorialResetOpen, setTutorialResetOpen] = useState(false);
  const [tutorialCopied, setTutorialCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inlineValueEditorRef = useRef<HTMLDivElement | null>(null);
  const inlineCapInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectButtonRef = useRef<HTMLButtonElement | null>(null);
  const nodeButtonRef = useRef<HTMLButtonElement | null>(null);
  const concatenateButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const clientRef = useRef<PyodideBridgeClient | null>(null);
  const projectRef = useRef<CircuitProject>(project);
  const projectHistoryRef = useRef<ProjectHistory>(projectHistory);
  const gridRect = gridRectForView(viewBox);

  useEffect(() => {
    const client = new PyodideBridgeClient();
    clientRef.current = client;
    let cancelled = false;
    let analysisWarmupTimer: number | null = null;

    setEngineWarmup({ base: "warming", analysis: "idle", error: null });
    client
      .prewarmBase()
      .then(() => {
        if (cancelled) {
          return;
        }
        setEngineWarmup({ base: "ready", analysis: "warming", error: null });
        analysisWarmupTimer = window.setTimeout(() => {
          client
            .prewarmAnalysis()
            .then(() => {
              if (!cancelled) {
                setEngineWarmup({
                  base: "ready",
                  analysis: "ready",
                  error: null,
                });
              }
            })
            .catch((error) => {
              if (!cancelled) {
                setEngineWarmup({
                  base: "ready",
                  analysis: "error",
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            });
        }, 300);
      })
      .catch((error) => {
        if (!cancelled) {
          setEngineWarmup({
            base: "error",
            analysis: "idle",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
      if (analysisWarmupTimer !== null) {
        window.clearTimeout(analysisWarmupTimer);
      }
      client.dispose();
    };
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    }
  }, []);

  useEffect(() => {
    if (!isTutorialDismissed()) {
      setTutorialPromptOpen(true);
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
  const inlineValueEditorEdge =
    selectedEdge?.identifier === inlineValueEditorEdgeId ? selectedEdge : null;
  const currentProjectSnapshot = useMemo(
    () => serializeProjectForDirtyCheck(project),
    [project],
  );
  const hasUnsavedChanges = currentProjectSnapshot !== cleanProjectSnapshot;
  const canUndo = projectHistory.past.length > 0;
  const canRedo = projectHistory.future.length > 0;
  const hasProjectContent =
    project.state.nodes.length > 0 || project.state.edges.length > 0;
  const canStartNewProject =
    hasProjectContent || hasUnsavedChanges || output !== null || canUndo || canRedo;
  const hasGeneratedSnippet = Boolean(output?.snippet);
  const statusIsCopyConfirmation = engineStatus === COPY_MATRICES_STATUS;
  const outputParameters = useMemo(() => output?.parameters ?? [], [output]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!output) {
      setModalAnalysis(null);
      return;
    }
    setParameterValues((current) => {
      const next: Record<string, string> = {};
      for (const name of outputParameters) {
        next[name] = current[name] ?? "";
      }
      return next;
    });
  }, [output, outputParameters]);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }

    const handleNativeCanvasWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const anchor = svgPointFromClient(canvasElement, event.clientX, event.clientY);
      const normalizedDelta = normalizeWheelDelta(event);
      const limitedDelta = clamp(
        normalizedDelta,
        -WHEEL_DELTA_LIMIT,
        WHEEL_DELTA_LIMIT,
      );
      const factor = Math.exp(limitedDelta * WHEEL_ZOOM_SENSITIVITY);
      setPanState(null);
      setMarqueeState(null);
      setGroundDragState(null);
      setViewBox((current) => zoomViewBox(current, factor, anchor));
    };

    canvasElement.addEventListener("wheel", handleNativeCanvasWheel, {
      passive: false,
    });
    return () =>
      canvasElement.removeEventListener("wheel", handleNativeCanvasWheel);
  }, []);

  useEffect(() => {
    if (project.state.nodes.length > 0 && tutorialPromptOpen && tutorialStep === null) {
      dismissTutorial();
    }
  }, [project.state.nodes.length, tutorialPromptOpen, tutorialStep]);

  useEffect(() => {
    if (inlineValueEditorEdgeId === null) {
      return;
    }
    if (
      selectedEdgeId !== inlineValueEditorEdgeId ||
      !project.state.edges.some((edge) => edge.identifier === inlineValueEditorEdgeId)
    ) {
      setInlineValueEditorEdgeId(null);
    }
  }, [inlineValueEditorEdgeId, project.state.edges, selectedEdgeId]);

  useEffect(() => {
    if (inlineValueEditorEdgeId === null) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      inlineCapInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [inlineValueEditorEdgeId]);

  useEffect(() => {
    if (inlineValueEditorEdgeId === null) {
      return;
    }

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        inlineValueEditorRef.current?.contains(target)
      ) {
        return;
      }
      setInlineValueEditorEdgeId(null);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  }, [inlineValueEditorEdgeId]);

  useLayoutEffect(() => {
    if (!inlineValueEditorEdge) {
      setInlineValueEditorPosition(null);
      return;
    }

    setInlineValueEditorPosition(
      inlineEdgeEditorPosition(
        inlineValueEditorEdge,
        projectRef.current.state.nodes,
        canvasRef.current,
        canvasStageRef.current,
      ),
    );
  }, [inlineValueEditorEdge, viewBox]);

  useEffect(() => {
    if (inlineValueEditorEdgeId === null) {
      return;
    }

    function updateInlineEditorPosition() {
      const currentEdge = projectRef.current.state.edges.find(
        (edge) => edge.identifier === inlineValueEditorEdgeId,
      );
      if (!currentEdge) {
        setInlineValueEditorPosition(null);
        return;
      }

      setInlineValueEditorPosition(
        inlineEdgeEditorPosition(
          currentEdge,
          projectRef.current.state.nodes,
          canvasRef.current,
          canvasStageRef.current,
        ),
      );
    }

    window.addEventListener("resize", updateInlineEditorPosition);
    return () => window.removeEventListener("resize", updateInlineEditorPosition);
  }, [inlineValueEditorEdgeId]);

  useEffect(() => {
    if (tutorialStep === null || tutorialStep === "welcome" || tutorialStep === "finish") {
      return;
    }

    const nextStep = nextTutorialStep({
      step: tutorialStep,
      project,
      mode,
      output,
      selectedEdgeId,
      tutorialCopied,
    });
    if (nextStep === "generate" && mode !== "select") {
      setMode("select");
      setPendingEdgeNodeId(null);
      setNodeDragState(null);
      setGroundDragState(null);
    }
    if (nextStep && nextStep !== tutorialStep) {
      setTutorialStep(nextStep);
    }
  }, [mode, output, project, selectedEdgeId, tutorialCopied, tutorialStep]);

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

  function setProjectState(nextProject: CircuitProject) {
    projectRef.current = nextProject;
    setProject(nextProject);
  }

  function setProjectHistoryState(nextHistory: ProjectHistory) {
    projectHistoryRef.current = nextHistory;
    setProjectHistory(nextHistory);
  }

  function recordProjectHistory(previousProject: CircuitProject) {
    const history = projectHistoryRef.current;
    setProjectHistoryState({
      past: appendProjectHistoryEntry(history.past, previousProject),
      future: [],
    });
  }

  function commitProjectChange(
    updateProject: (current: CircuitProject) => CircuitProject,
  ) {
    const currentProject = projectRef.current;
    const next = updateProject(currentProject);
    if (projectsMatch(currentProject, next)) {
      return;
    }
    recordProjectHistory(currentProject);
    setProjectState(next);
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
    setPastePreview(null);
    setInlineValueEditorEdgeId(null);
  }

  function restoreProjectFromHistory(nextProject: CircuitProject, message: string) {
    setProjectState(nextProject);
    resetProjectInteractionState();
    setOutput(null);
    setEngineStatus(message);
  }

  function undoProjectChange() {
    const history = projectHistoryRef.current;
    if (history.past.length === 0) {
      setEngineStatus("Nothing to undo.");
      return;
    }

    const currentProject = projectRef.current;
    const previous = history.past[history.past.length - 1];
    setProjectHistoryState({
      past: history.past.slice(0, -1),
      future: [currentProject, ...history.future].slice(0, PROJECT_HISTORY_LIMIT),
    });
    restoreProjectFromHistory(previous, "Undid last change.");
  }

  function redoProjectChange() {
    const history = projectHistoryRef.current;
    if (history.future.length === 0) {
      setEngineStatus("Nothing to redo.");
      return;
    }

    const currentProject = projectRef.current;
    const next = history.future[0];
    setProjectHistoryState({
      past: appendProjectHistoryEntry(history.past, currentProject),
      future: history.future.slice(1),
    });
    restoreProjectFromHistory(next, "Redid last change.");
  }

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
      setPastePreview({ anchor: svgPoint(event) });
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
      setProject((current) => {
        const next = moveGroundEdge(
          current,
          groundDragState.edgeId,
          nextOffset.x,
          nextOffset.y,
        );
        projectRef.current = next;
        return next;
      });
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
      setProject((current) => {
        const next = moveDraggedNodes(
          current,
          nodeDragState.nodePositions,
          delta.x,
          delta.y,
        );
        projectRef.current = next;
        return next;
      });
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

  function handleEdgePointerDown(event: PointerEvent<SVGLineElement>, edgeId: number) {
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
    setPastePreview(null);
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
    setPastePreview(null);
    setEngineStatus("Selected ground connection.");
    if (mode === "select" || mode === "box-select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      startGroundDrag(event, edge);
    } else {
      setGroundDragState(null);
    }
  }

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

  function copySelectedGraphElements() {
    const clipboard = clipboardFromSelection(project, selectedNodeIds);
    if (!clipboard) {
      setEngineStatus("Nothing selected to copy.");
      return;
    }

    setSelectionClipboard(clipboard);
    setGroundDragState(null);
    setPastePreview(null);
    setEngineStatus(`Copied ${clipboard.nodes.length} node(s) to clipboard.`);
  }

  function openConcatenateDialog() {
    if (selectedNodeIds.length === 0) {
      setEngineStatus("Select at least one node to concatenate.");
      return;
    }
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    setPastePreview(null);
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
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    setPastePreview(null);
    setMode("select");
    setOutput(null);
    setEngineStatus(
      `Concatenated ${repeats} repeat${repeats === 1 ? "" : "s"}; added ${result.nodeIds.length} node(s).`,
    );
  }

  function startPastePreview() {
    if (!selectionClipboard) {
      setEngineStatus("Clipboard is empty.");
      return;
    }

    setMode("select");
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
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
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
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

  async function generateOutput() {
    await runGenerateOutput();
  }

  async function runGenerateOutput(): Promise<OutputResult | null> {
    setEngineStatus(
      engineWarmup.base === "ready"
        ? "Generating matrices..."
        : "Python engine is warming; generating when ready...",
    );
    setSnippetCopied(false);
    setModalAnalysis(null);
    try {
      const result = await clientRef.current!.generate(project);
      setEngineWarmup((current) => ({
        ...current,
        base: "ready",
        error: current.base === "error" ? null : current.error,
      }));
      if (result.error) {
        throw new Error(result.error);
      }
      setOutput(result);
      setEngineStatus(`Generated ${result.size} x ${result.size} matrices.`);
      return result;
    } catch (error) {
      setEngineWarmup((current) => ({
        ...current,
        base: current.base === "ready" ? current.base : "error",
        error: error instanceof Error ? error.message : String(error),
      }));
      setEngineStatus(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function updateParameterValue(name: string, value: string) {
    setParameterValues((current) => ({ ...current, [name]: value }));
    setModalAnalysis(null);
  }

  async function runModalAnalysis(): Promise<ModalAnalysisResult | null> {
    const result = output ?? (await runGenerateOutput());
    if (!result) {
      return null;
    }
    const missing = result.parameters.filter(
      (name) => (parameterValues[name] ?? "").trim() === "",
    );
    if (missing.length > 0) {
      setEngineStatus(`Missing parameter values: ${missing.join(", ")}`);
      return null;
    }

    setEngineWarmup((current) => ({
      base: "ready",
      analysis: current.analysis === "ready" ? "ready" : "warming",
      error: null,
    }));
    setEngineStatus(
      engineWarmup.analysis === "ready"
        ? "Running BBQ modal analysis..."
        : "Analysis engine is warming; running when ready...",
    );
    try {
      const analysis = await clientRef.current!.analyze(project, parameterValues);
      setEngineWarmup({ base: "ready", analysis: "ready", error: null });
      if (!analysis.available || analysis.error) {
        throw new Error(analysis.error ?? "BBQ modal analysis is unavailable.");
      }
      setModalAnalysis(analysis);
      const modeCount = analysis.frequencies_ghz?.length ?? 0;
      const zpfRowCount = analysis.branches?.length ?? 0;
      setEngineStatus(
        zpfRowCount > 0
          ? `Computed ${modeCount} mode(s) and ${zpfRowCount} JJ ZPF row(s).`
          : `Computed ${modeCount} mode frequency result(s).`,
      );
      return analysis;
    } catch (error) {
      setModalAnalysis(null);
      setEngineWarmup((current) => ({
        ...current,
        analysis: current.analysis === "ready" ? "ready" : "error",
        error: error instanceof Error ? error.message : String(error),
      }));
      setEngineStatus(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function copySnippet() {
    const result = output?.snippet ? output : await runGenerateOutput();
    if (!result?.snippet) {
      return;
    }
    await navigator.clipboard.writeText(result.snippet);
    setEngineStatus(COPY_MATRICES_STATUS);
    setSnippetCopied(true);
    setTutorialCopied(true);
  }

  async function exportAnalysisCsv() {
    const result = output ?? (await runGenerateOutput());
    if (!result) {
      return;
    }
    const analysis = modalAnalysis?.available
      ? modalAnalysis
      : await runModalAnalysis();
    if (!analysis?.available || analysis.error) {
      return;
    }

    setEngineStatus("Exporting analysis table CSV...");
    try {
      const exportResult = await clientRef.current!.exportAnalysisJson(
        project,
        parameterValues,
        analysis,
      );
      if (exportResult.error) {
        throw new Error(exportResult.error);
      }
      downloadCsv(
        "cqedraw-analysis-table.csv",
        exportResult.columns,
        exportResult.rows,
      );
      setEngineStatus("Exported analysis table CSV.");
    } catch (error) {
      setEngineStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function saveProject() {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cqedraw-project.json";
    document.body.append(link);
    link.click();
    link.remove();
    setCleanProjectSnapshot(currentProjectSnapshot);
    setEngineStatus("Project saved.");
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadProject(file: File) {
    const parsed = JSON.parse(await file.text());
    const next = normalizeProject(parsed);
    setProjectState(next);
    setProjectHistoryState({ past: [], future: [] });
    setCleanProjectSnapshot(serializeProjectForDirtyCheck(next));
    setViewBox(fitProjectView(next));
    setSelectedEdgeId(null);
    clearNodeSelection();
    setPendingEdgeNodeId(null);
    setPanState(null);
    setMarqueeState(null);
    setPastePreview(null);
    setOutput(null);
  }

  function resetToNewProject() {
    const next = emptyProject();
    setProjectState(next);
    setProjectHistoryState({ past: [], future: [] });
    setCleanProjectSnapshot(serializeProjectForDirtyCheck(next));
    setMode("node");
    resetProjectInteractionState();
    setSelectionClipboard(null);
    setViewBox(DEFAULT_VIEW_BOX);
    setOutput(null);
    setNewProjectDialogOpen(false);
    setTutorialResetOpen(false);
    setTutorialStep(null);
    setTutorialCopied(false);
    setEngineStatus("Started new project.");
  }

  function requestNewProject() {
    if (!canStartNewProject) {
      setEngineStatus("Project is already empty.");
      return;
    }
    if (hasProjectContent || hasUnsavedChanges) {
      setNewProjectDialogOpen(true);
      return;
    }
    resetToNewProject();
  }

  function closeNewProjectDialog() {
    setNewProjectDialogOpen(false);
    window.requestAnimationFrame(() => newProjectButtonRef.current?.focus());
  }

  function confirmNewProject() {
    resetToNewProject();
    window.requestAnimationFrame(() => nodeButtonRef.current?.focus());
  }

  function closeHelp() {
    setHelpOpen(false);
    window.requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  function beginTutorial() {
    const next = emptyProject();
    setProjectState(next);
    setProjectHistoryState({ past: [], future: [] });
    setCleanProjectSnapshot(serializeProjectForDirtyCheck(next));
    setMode("node");
    clearNodeSelection();
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
    setGroundDragState(null);
    setPanState(null);
    setMarqueeState(null);
    setPastePreview(null);
    setViewBox(DEFAULT_VIEW_BOX);
    setOutput(null);
    setEngineStatus("Ready.");
    setTutorialCopied(false);
    setTutorialPromptOpen(false);
    setTutorialResetOpen(false);
    setTutorialStep("welcome");
  }

  function requestTutorialStart() {
    setHelpOpen(false);
    if (project.state.nodes.length > 0 || project.state.edges.length > 0) {
      setTutorialResetOpen(true);
      return;
    }
    beginTutorial();
  }

  function dismissTutorial() {
    rememberTutorialDismissed();
    setTutorialPromptOpen(false);
    setTutorialStep(null);
    setTutorialResetOpen(false);
  }

  function finishTutorial() {
    rememberTutorialDismissed();
    setTutorialStep(null);
  }

  function closeTutorialReset() {
    setTutorialResetOpen(false);
    window.requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  function confirmTutorialReset() {
    beginTutorial();
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('[data-testid="tutorial-callout"] button')?.focus(),
    );
  }

  function zoomCanvas(factor: number) {
    setViewBox((current) => zoomViewBox(current, factor));
  }

  function fitCanvasView() {
    setViewBox(fitProjectView(project));
  }

  useEffect(() => {
    function handleAppKeyDown(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        shouldIgnoreAppShortcut(
          event.target,
          helpOpen ||
            tutorialResetOpen ||
            concatenateDialogOpen ||
            newProjectDialogOpen,
        )
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasSystemModifier = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        event.preventDefault();
        if (!pastePreview && pendingEdgeNodeId !== null) {
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
          void generateOutput();
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
        (selectedEdgeId !== null ||
          selectedNodeId !== null ||
          selectedNodeIds.length > 0)
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
  const activePasteClipboard = pastePreview ? selectionClipboard : null;
  const concatenateAnalysis = analyzeConcatenateSelection(project, selectedNodeIds);
  const concatenatePreviewBridges = concatenateDialogOpen
    ? concatenatePreviewBridgesForSelection(
        project,
        selectedNodeIds,
        concatenatePreviewPairs,
      )
    : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" />
          <div>
            <strong>cQEDraw</strong>
            <span>Web</span>
          </div>
        </div>
        <div className="toolbar" aria-label="Tools">
          <ToolButton
            active={mode === "select"}
            icon={<MousePointer2 size={17} />}
            label="Select"
            shortcut="V"
            onClick={() => setModeAndReset("select")}
          />
          <ToolButton
            active={mode === "box-select"}
            icon={<BoxSelect size={17} />}
            label="Box Select"
            shortcut="B"
            onClick={() => setModeAndReset("box-select")}
          />
          <ToolButton
            active={mode === "node"}
            buttonRef={nodeButtonRef}
            highlight={tutorialStep === "first-node" || tutorialStep === "second-node"}
            icon={<Circle size={17} />}
            label="Node"
            shortcut="N"
            onClick={() => setModeAndReset("node")}
          />
          <ToolButton
            active={mode === "edge"}
            highlight={tutorialStep === "edge-mode"}
            icon={<GitBranch size={17} />}
            label="Edge"
            shortcut="E"
            onClick={() => setModeAndReset("edge")}
          />
          <ToolButton
            active={mode === "ground"}
            highlight={tutorialStep === "ground-mode"}
            icon={<GroundIcon size={17} />}
            label="Ground"
            shortcut="G"
            onClick={() => setModeAndReset("ground")}
          />
          <ToolButton
            disabled={selectedNodeIds.length < 2}
            icon={<Merge size={17} />}
            label="Merge"
            shortcut="M"
            onClick={mergeSelectedNodes}
          />
          <ToolButton
            icon={<ClipboardCopy size={17} />}
            label="Copy Selection"
            shortcut="Ctrl/Cmd+C"
            onClick={copySelectedGraphElements}
          />
          <ToolButton
            icon={<ClipboardPaste size={17} />}
            label="Paste"
            shortcut="Ctrl/Cmd+V"
            onClick={startPastePreview}
          />
          <ToolButton
            buttonRef={concatenateButtonRef}
            disabled={selectedNodeIds.length === 0}
            icon={<Repeat2 size={17} />}
            label="Concatenate"
            shortcut="D"
            onClick={openConcatenateDialog}
          />
          <ToolButton
            icon={<Trash2 size={17} />}
            label="Delete"
            shortcut="Del/Backspace"
            onClick={deleteSelection}
          />
          <ToolButton
            disabled={!canUndo}
            icon={<Undo2 size={17} />}
            label="Undo"
            shortcut="Ctrl/Cmd+Z"
            onClick={undoProjectChange}
          />
          <ToolButton
            disabled={!canRedo}
            icon={<Redo2 size={17} />}
            label="Redo"
            shortcut="Ctrl/Cmd+Y"
            onClick={redoProjectChange}
          />
        </div>
        <div className="toolbar actions" aria-label="Project actions">
          <ToolButton
            buttonRef={newProjectButtonRef}
            disabled={!canStartNewProject}
            icon={<SquarePlus size={17} />}
            label="New project"
            onClick={requestNewProject}
          />
          <ToolButton
            highlight={tutorialStep === "generate"}
            icon={<Play size={17} />}
            label="Generate"
            shortcut="Ctrl/Cmd+Enter"
            onClick={generateOutput}
          />
          {hasGeneratedSnippet ? (
            <ToolButton
              confirmation={snippetCopied ? "Copied" : undefined}
              highlight={tutorialStep === "copy"}
              icon={snippetCopied ? <Check size={17} /> : <Copy size={17} />}
              iconOnly={false}
              label="Copy matrices"
              onClick={copySnippet}
            />
          ) : null}
          <ToolButton
            icon={<Download size={17} />}
            label="Save"
            shortcut="Ctrl/Cmd+S"
            onClick={saveProject}
          />
          <span aria-live="polite" data-testid="save-status">
            {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
          </span>
          <ToolButton
            icon={<Upload size={17} />}
            label="Load"
            shortcut="Ctrl/Cmd+O"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolButton
            buttonRef={helpButtonRef}
            icon={<CircleHelp size={17} />}
            label="Help"
            onClick={() => setHelpOpen(true)}
          />
        </div>
        <input
          ref={fileInputRef}
          className="hidden-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void loadProject(file);
            }
            event.currentTarget.value = "";
          }}
        />
      </header>

      <section className="workspace">
        <div className="canvas-pane">
          <div className="canvas-stage" ref={canvasStageRef}>
            <div className="canvas-controls" aria-label="Canvas view controls">
              <IconButton
                icon={<ZoomIn size={17} />}
                label="Zoom in"
                onClick={() => zoomCanvas(ZOOM_IN_FACTOR)}
                shortcut="+/="
              />
              <IconButton
                icon={<ZoomOut size={17} />}
                label="Zoom out"
                onClick={() => zoomCanvas(ZOOM_OUT_FACTOR)}
                shortcut="-"
              />
              <IconButton
                icon={<Maximize2 size={17} />}
                label="Fit view"
                onClick={fitCanvasView}
                shortcut="0"
              />
            </div>
            <svg
              className={[
                "circuit-canvas",
                mode === "select" ? "pan-ready" : "",
                mode === "box-select" ? "box-select-ready" : "",
                panState ? "panning" : "",
                marqueeState ? "selecting" : "",
                tutorialStep === "first-node" || tutorialStep === "second-node"
                  ? "tutorial-highlight-surface"
                  : "",
              ].join(" ")}
              data-testid="canvas"
              ref={canvasRef}
              viewBox={viewBoxToString(viewBox)}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerCancel}
              onPointerLeave={handleCanvasPointerCancel}
            >
              <defs>
                <pattern
                  id="grid"
                  width={GRID_TILE_SIZE}
                  height={GRID_TILE_SIZE}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${GRID_TILE_SIZE} 0 L 0 0 0 ${GRID_TILE_SIZE}`}
                    fill="none"
                    stroke="#dce5ee"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect
                data-testid="grid-surface"
                x={gridRect.x}
                y={gridRect.y}
                width={gridRect.width}
                height={gridRect.height}
                fill="url(#grid)"
              />
              {marqueeRect ? (
                <rect
                  className="selection-marquee"
                  data-testid="selection-marquee"
                  x={marqueeRect.x}
                  y={marqueeRect.y}
                  width={marqueeRect.width}
                  height={marqueeRect.height}
                />
              ) : null}
              {project.state.nodes.length === 0 ? <CanvasHint /> : null}
              {project.state.edges.map((edge) => (
                <CircuitEdgeShape
                  key={edge.identifier}
                  edge={edge}
                  nodes={project.state.nodes}
                  selected={selectedEdgeId === edge.identifier}
                  onPointerDown={handleEdgePointerDown}
                  onGroundPointerDown={handleGroundPointerDown}
                />
              ))}
              {concatenatePreviewBridges.length > 0 ? (
                <ConcatenatePreview bridges={concatenatePreviewBridges} />
              ) : null}
              {project.state.nodes.map((node) => (
                <g key={node.identifier}>
                  <circle
                    data-testid={`node-${node.identifier}`}
                    className={[
                      "node-circle",
                      selectedNodeIds.includes(node.identifier) ? "selected" : "",
                      selectedNodeId === node.identifier ? "focused" : "",
                      pendingEdgeNodeId === node.identifier ? "pending" : "",
                    ].join(" ")}
                    cx={node.x}
                    cy={node.y}
                    r={NODE_RADIUS}
                    onPointerDown={(event) => handleNodePointerDown(event, node.identifier)}
                  />
                  <text
                    className="node-label"
                    data-testid={`node-matrix-label-${node.identifier}`}
                    x={node.x + 16}
                    y={node.y + 5}
                  >
                    {matrixNodeLabels.get(node.identifier) ?? node.identifier}
                  </text>
                </g>
              ))}
              {pastePreview && activePasteClipboard ? (
                <PastePreview
                  anchor={pastePreview.anchor}
                  clipboard={activePasteClipboard}
                />
              ) : null}
            </svg>
            {inlineValueEditorEdge && inlineValueEditorPosition ? (
              <InlineEdgeValueEditor
                capInputRef={inlineCapInputRef}
                edge={inlineValueEditorEdge}
                editorRef={inlineValueEditorRef}
                position={inlineValueEditorPosition}
                onClose={() => setInlineValueEditorEdgeId(null)}
                onValueChange={updateEdgeValueText}
              />
            ) : null}
          </div>
          <div
            aria-live="polite"
            className={[
              "status-line",
              statusIsCopyConfirmation ? "status-line-success" : "",
            ].join(" ")}
            data-testid="output-status"
            role="status"
          >
            {engineStatus}
          </div>
        </div>

        <aside className="side-pane">
          <section className="panel">
            <h2>Inspector</h2>
            {selectedEdge ? (
              <div className="form-grid">
                <label>
                  <span>Edge</span>
                  <input
                    value={selectedEdgeLabel ?? ""}
                    readOnly
                    onFocus={() => setInlineValueEditorEdgeId(null)}
                  />
                </label>
                <label>
                  <span>Capacitance</span>
                  <input
                    className={
                      tutorialStep === "edge-values" || tutorialStep === "ground-values"
                        ? "tutorial-highlight-control"
                        : undefined
                    }
                    data-testid="cap-input"
                    value={selectedEdge.capacitance_text ?? ""}
                    onFocus={() => setInlineValueEditorEdgeId(null)}
                    onChange={(event) => {
                      updateEdgeValueText(selectedEdge.identifier, {
                        capacitanceText: event.target.value,
                      });
                    }}
                  />
                </label>
                <label>
                  <span>Linear inductance</span>
                  <input
                    className={
                      tutorialStep === "edge-values"
                        ? "tutorial-highlight-control"
                        : undefined
                    }
                    data-testid="ind-input"
                    value={selectedEdge.inductance_text ?? ""}
                    onFocus={() => setInlineValueEditorEdgeId(null)}
                    onChange={(event) => {
                      updateEdgeValueText(selectedEdge.identifier, {
                        inductanceText: event.target.value,
                      });
                    }}
                  />
                </label>
                <label>
                  <span>Josephson inductance</span>
                  <input
                    data-testid="jj-ind-input"
                    value={selectedEdge.josephson_inductance_text ?? ""}
                    onFocus={() => setInlineValueEditorEdgeId(null)}
                    onChange={(event) => {
                      updateEdgeValueText(selectedEdge.identifier, {
                        josephsonInductanceText: event.target.value,
                      });
                    }}
                  />
                </label>
                {selectedEdge.josephson_inductance_text?.trim() ? (
                  <div className="phase-control" data-testid="jj-phase-control">
                    <span data-testid="jj-phase-label">
                      {josephsonPhaseLabel(selectedEdge, matrixNodeLabels)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateEdgeValueText(selectedEdge.identifier, {
                          josephsonPhaseSign:
                            selectedEdge.josephson_phase_sign === -1 ? 1 : -1,
                        })
                      }
                    >
                      Reverse
                    </button>
                  </div>
                ) : null}
              </div>
            ) : selectedNode ? (
              <div className="form-grid">
                <label>
                  <span>Matrix index</span>
                  <input
                    data-testid="node-matrix-index-input"
                    readOnly
                    value={matrixNodeLabels.get(selectedNode.identifier) ?? ""}
                  />
                </label>
                <label>
                  <span>Name</span>
                  <input
                    data-testid="node-name-input"
                    value={selectedNode.name}
                    onChange={(event) =>
                      commitProjectChange((current) =>
                        renameNode(current, selectedNode.identifier, event.target.value),
                      )
                    }
                  />
                </label>
              </div>
            ) : selectedNodeIds.length > 1 ? (
              <div className="metrics">
                <span data-testid="merge-target-summary">
                  Merge keeps {mergeTargetLabel}
                </span>
              </div>
            ) : (
              <div className="metrics">
                <span>{project.state.nodes.length} nodes</span>
                <span>{project.state.edges.length} edges</span>
              </div>
            )}
          </section>

          <section className="panel output-panel">
            <div className="output-panel-heading">
              <h2>Output</h2>
              <EngineWarmupBadge warmup={engineWarmup} />
            </div>
            <EntryList title="C entries" testId="c-entries" entries={output?.c_entries ?? []} />
            <EntryList
              title="L_inv entries"
              testId="l-entries"
              entries={output?.l_inv_entries ?? []}
            />
            <MatrixNodeList nodes={output?.matrix_nodes ?? []} />
            <JosephsonBranchList branches={output?.josephson_branches ?? []} />
            <ParameterValuePanel
              disabled={!output}
              onAnalyze={runModalAnalysis}
              onChange={updateParameterValue}
              onExport={exportAnalysisCsv}
              parameters={outputParameters}
              values={parameterValues}
            />
            <ModalAnalysisTable result={modalAnalysis} />
          </section>
        </aside>
      </section>
      {tutorialPromptOpen && tutorialStep === null && project.state.nodes.length === 0 ? (
        <TutorialPrompt onSkip={dismissTutorial} onStart={beginTutorial} />
      ) : null}
      {tutorialStep ? (
        <TutorialCallout
          step={tutorialStep}
          placement={tutorialPlacement(tutorialStep)}
          onFinish={finishTutorial}
          onNext={() => setTutorialStep("first-node")}
          onSkip={dismissTutorial}
        />
      ) : null}
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
          onPortCountChange={(portCount) =>
            concatenatePortPairsForSelection(projectRef.current, selectedNodeIds, portCount)
          }
          onPreviewChange={setConcatenatePreviewPairs}
        />
      ) : null}
      {helpOpen ? <HelpDialog onClose={closeHelp} onStartTutorial={requestTutorialStart} /> : null}
    </main>
  );
}

function CanvasHint() {
  return (
    <g className="canvas-hint" data-testid="canvas-hint">
      <text x={CANVAS_WIDTH / 2} y={250} textAnchor="middle">
        <tspan className="canvas-hint-title" x={CANVAS_WIDTH / 2}>
          Click the canvas to place nodes.
        </tspan>
        <tspan x={CANVAS_WIDTH / 2} dy="28">
          Use Edge to connect nodes, Ground to add a reference,
        </tspan>
        <tspan x={CANVAS_WIDTH / 2} dy="24">
          then select an edge to enter C/L/LJ.
        </tspan>
        <tspan x={CANVAS_WIDTH / 2} dy="28">
          Generate builds matrices; Copy matrices appears when ready.
        </tspan>
      </text>
    </g>
  );
}

function TutorialPrompt({
  onSkip,
  onStart,
}: {
  onSkip: () => void;
  onStart: () => void;
}) {
  return (
    <aside
      aria-label="Tutorial prompt"
      className="tutorial-prompt"
      data-testid="tutorial-prompt"
    >
      <strong>New to cQEDraw?</strong>
      <p>Follow a short tutorial to create a small circuit and copy the matrix snippet.</p>
      <div>
        <button type="button" onClick={onStart}>
          Start tutorial
        </button>
        <button type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
    </aside>
  );
}

function TutorialCallout({
  onFinish,
  onNext,
  onSkip,
  placement,
  step,
}: {
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  placement: TutorialPlacement;
  step: TutorialStep;
}) {
  const details = TUTORIAL_STEPS[step];
  const isWelcome = step === "welcome";
  const isFinish = step === "finish";

  return (
    <aside
      aria-live="polite"
      className={`tutorial-callout tutorial-callout-${placement}`}
      data-testid="tutorial-callout"
    >
      <span>{details.progress}</span>
      <h2>{details.title}</h2>
      <p>{details.body}</p>
      <div>
        {isWelcome ? (
          <button type="button" onClick={onNext}>
            Start
          </button>
        ) : null}
        {isFinish ? (
          <button type="button" onClick={onFinish}>
            Done
          </button>
        ) : (
          <button type="button" onClick={onSkip}>
            Skip
          </button>
        )}
      </div>
    </aside>
  );
}

interface ConcatenatePairRow {
  enabled: boolean;
  leftNodeId: number;
  rightNodeId: number;
}

interface DialogDragState {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

function ConcatenateDialog({
  analysis,
  onCancel,
  onConfirm,
  onPortCountChange,
  onPreviewChange,
}: {
  analysis: ConcatenateSelectionAnalysis;
  onCancel: () => void;
  onConfirm: (repeats: number, portPairs: ConcatenatePortPair[]) => void;
  onPortCountChange: (portCount: number) => ConcatenatePortPair[];
  onPreviewChange: (portPairs: ConcatenatePortPair[]) => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [repeatText, setRepeatText] = useState("1");
  const [portText, setPortText] = useState(String(analysis.autoPortCount));
  const [pairRows, setPairRows] = useState<ConcatenatePairRow[]>(
    pairRowsFromPortPairs(analysis.detectedPairs),
  );
  const [error, setError] = useState("");
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });
  const [dialogDragState, setDialogDragState] =
    useState<DialogDragState | null>(null);
  const nodeOptions = analysis.selectedNodes;
  const activePairs = useMemo(
    () => activeConcatenatePortPairs(pairRows),
    [pairRows],
  );
  const pairError = concatenatePairValidationError(activePairs);
  const visibleError = error || pairError;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    onPreviewChange(pairError ? [] : activePairs);
  }, [activePairs, onPreviewChange, pairError]);

  useEffect(() => () => onPreviewChange([]), [onPreviewChange]);

  function updatePortText(nextText: string) {
    setPortText(nextText);
    setError("");

    const portCount = Number(nextText.trim());
    if (
      nextText.trim() === "" ||
      !Number.isInteger(portCount) ||
      portCount < 0 ||
      portCount > analysis.maxPortCount
    ) {
      return;
    }

    setPairRows(
      pairRowsFromPortPairs(
        onPortCountChange(portCount),
      ),
    );
  }

  function updatePairRow(index: number, updates: Partial<ConcatenatePairRow>) {
    setPairRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...updates } : row,
      ),
    );
    setError("");
  }

  function startDialogDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    const dialogRect = dialogRef.current?.getBoundingClientRect();
    if (!dialogRect) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDialogDragState({
      maxX: dialogOffset.x + window.innerWidth - 12 - dialogRect.right,
      maxY: dialogOffset.y + window.innerHeight - 12 - dialogRect.bottom,
      minX: dialogOffset.x + 12 - dialogRect.left,
      minY: dialogOffset.y + 12 - dialogRect.top,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: dialogOffset.x,
      startY: dialogOffset.y,
    });
    event.preventDefault();
  }

  function moveDialog(event: PointerEvent<HTMLElement>) {
    if (!dialogDragState || event.pointerId !== dialogDragState.pointerId) {
      return;
    }
    setDialogOffset({
      x: clamp(
        dialogDragState.startX + event.clientX - dialogDragState.startClientX,
        dialogDragState.minX,
        dialogDragState.maxX,
      ),
      y: clamp(
        dialogDragState.startY + event.clientY - dialogDragState.startClientY,
        dialogDragState.minY,
        dialogDragState.maxY,
      ),
    });
  }

  function stopDialogDrag(event: PointerEvent<HTMLElement>) {
    if (dialogDragState && event.pointerId === dialogDragState.pointerId) {
      setDialogDragState(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedRepeats = repeatText.trim();
    const trimmedPorts = portText.trim();
    const repeats = Number(trimmedRepeats);
    if (!Number.isInteger(repeats) || repeats < 1) {
      setError("Enter a whole number of at least 1.");
      return;
    }
    const portCount = Number(trimmedPorts);
    if (
      trimmedPorts === "" ||
      !Number.isInteger(portCount) ||
      portCount < 0 ||
      portCount > analysis.maxPortCount
    ) {
      setError(`Enter a pairing row count from 0 to ${analysis.maxPortCount}.`);
      return;
    }
    if (pairError) {
      setError(pairError);
      return;
    }
    onConfirm(repeats, activePairs);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="concatenate-dialog-title"
        aria-modal="true"
        className={[
          "help-dialog",
          "draggable-dialog",
          dialogDragState ? "dragging" : "",
        ].join(" ")}
        onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, onCancel)}
        ref={dialogRef}
        role="dialog"
        style={{
          transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)`,
        }}
      >
        <form onSubmit={handleSubmit}>
          <header
            className="dialog-drag-header"
            onPointerCancel={stopDialogDrag}
            onPointerDown={startDialogDrag}
            onPointerMove={moveDialog}
            onPointerUp={stopDialogDrag}
          >
            <h2 id="concatenate-dialog-title">Concatenate selection</h2>
            <span aria-hidden="true" className="dialog-drag-handle">
              <GripHorizontal size={18} />
            </span>
          </header>
          <p>
            {analysis.selectedNodes.length} node
            {analysis.selectedNodes.length === 1 ? "" : "s"} selected.
          </p>
          <label className="dialog-field">
            <span>Number of repeats</span>
            <input
              aria-describedby={visibleError ? "concatenate-dialog-error" : undefined}
              aria-label="Number of repeats"
              data-testid="concatenate-repeat-input"
              min="1"
              ref={inputRef}
              step="1"
              type="number"
              value={repeatText}
              onChange={(event) => {
                setRepeatText(event.target.value);
                setError("");
              }}
            />
          </label>
          <label className="dialog-field">
            <span>Pairing rows</span>
            <input
              aria-describedby={visibleError ? "concatenate-dialog-error" : undefined}
              aria-label="Pairing rows"
              data-testid="concatenate-port-input"
              max={analysis.maxPortCount}
              min="0"
              step="1"
              type="number"
              value={portText}
              onChange={(event) => updatePortText(event.target.value)}
            />
          </label>
          <fieldset className="port-pairings">
            <legend>Port pairings</legend>
            {pairRows.length === 0 ? (
              <p data-testid="concatenate-no-pairs">No shared port pairings.</p>
            ) : (
              <div className="port-pair-list">
                {pairRows.map((row, index) => (
                  <div
                    className={[
                      "port-pair-row",
                      row.enabled ? "" : "disabled",
                    ].join(" ")}
                    data-testid={`concatenate-pair-row-${index}`}
                    key={index}
                  >
                    <label className="port-pair-toggle">
                      <input
                        aria-label={`Use pair ${index + 1}`}
                        checked={row.enabled}
                        type="checkbox"
                        onChange={(event) =>
                          updatePairRow(index, { enabled: event.target.checked })
                        }
                      />
                      <span>Pair {index + 1}</span>
                    </label>
                    <label>
                      <span>Left port</span>
                      <select
                        aria-label={`Pair ${index + 1} left port`}
                        disabled={!row.enabled}
                        value={row.leftNodeId}
                        onChange={(event) =>
                          updatePairRow(index, {
                            leftNodeId: Number(event.target.value),
                          })
                        }
                      >
                        {nodeOptions.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="port-pair-to">with</span>
                    <label>
                      <span>Right port</span>
                      <select
                        aria-label={`Pair ${index + 1} right port`}
                        disabled={!row.enabled}
                        value={row.rightNodeId}
                        onChange={(event) =>
                          updatePairRow(index, {
                            rightNodeId: Number(event.target.value),
                          })
                        }
                      >
                        {nodeOptions.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          {visibleError ? (
            <p className="dialog-error" id="concatenate-dialog-error" role="alert">
              {visibleError}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit">Concatenate</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function pairRowsFromPortPairs(portPairs: ConcatenatePortPair[]): ConcatenatePairRow[] {
  return portPairs.map((pair) => ({
    enabled: true,
    leftNodeId: pair.leftNodeId,
    rightNodeId: pair.rightNodeId,
  }));
}

function activeConcatenatePortPairs(
  pairRows: ConcatenatePairRow[],
): ConcatenatePortPair[] {
  return pairRows
    .filter((row) => row.enabled)
    .map((row) => ({
      leftNodeId: row.leftNodeId,
      rightNodeId: row.rightNodeId,
    }));
}

function concatenatePairValidationError(
  portPairs: ConcatenatePortPair[],
): string {
  const seenNodeIds = new Set<number>();
  for (const pair of portPairs) {
    if (pair.leftNodeId === pair.rightNodeId) {
      return "Each enabled pair must use two different nodes.";
    }
    if (
      seenNodeIds.has(pair.leftNodeId) ||
      seenNodeIds.has(pair.rightNodeId)
    ) {
      return "Each enabled pair needs unique nodes across left and right ports.";
    }
    seenNodeIds.add(pair.leftNodeId);
    seenNodeIds.add(pair.rightNodeId);
  }
  return "";
}

function NewProjectDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="new-project-title"
        aria-modal="true"
        className="help-dialog"
        onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, onCancel)}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id="new-project-title">Start new project?</h2>
        </header>
        <p>
          This clears the current drawing, output, selection, and undo history. Save the
          project first if you want to keep it.
        </p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Start new project
          </button>
        </div>
      </section>
    </div>
  );
}

function TutorialResetDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="tutorial-reset-title"
        aria-modal="true"
        className="help-dialog"
        onKeyDown={(event) => handleDialogKeyDown(event, dialogRef.current, onCancel)}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id="tutorial-reset-title">Start tutorial?</h2>
        </header>
        <p>
          Starting the tutorial clears the current drawing. Save the project first if you
          want to keep it.
        </p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            Start tutorial
          </button>
        </div>
      </section>
    </div>
  );
}

function HelpDialog({
  onClose,
  onStartTutorial,
}: {
  onClose: () => void;
  onStartTutorial: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    handleDialogKeyDown(event, dialogRef.current, onClose);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="help-dialog-title"
        aria-modal="true"
        className="help-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id="help-dialog-title">Help</h2>
          <div className="dialog-actions">
            <button type="button" onClick={onStartTutorial}>
              Start tutorial
            </button>
            <button ref={closeButtonRef} type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <ol>
          <li>Use Node and click the canvas to place circuit nodes.</li>
          <li>Use Edge, then click two nodes to connect them.</li>
          <li>Use Ground, then click a node to add its ground reference; select and delete a ground connection to remove it.</li>
          <li>Select an edge and enter capacitance, linear inductance, and Josephson inductance in the Inspector.</li>
          <li>Inputs accept SymPy-style values such as Cj, 40e-15, Lgeom, and Lj.</li>
          <li>Hover over toolbar icons or tab to them to see their labels and shortcuts.</li>
          <li>Use the canvas buttons, +/=, -, 0, wheel, or trackpad to adjust the view; use Select and drag empty canvas to pan, or use Box Select to select an area.</li>
          <li>Use Copy Selection and Paste, or Ctrl/Cmd+C and Ctrl/Cmd+V, to duplicate selected nodes and their contained connections.</li>
          <li>Use Concatenate to repeat the selected block to the right.</li>
          <li>Use New project to clear the drawing and start from a default canvas.</li>
          <li>Shortcuts: V Select, B Box Select, N Node, E Edge, G Ground, M Merge, D Concatenate, Esc cancel, Delete remove selection.</li>
          <li>Use Ctrl/Cmd+Z and Ctrl/Cmd+Y to move through project edits.</li>
          <li>Use Ctrl/Cmd+S to save, Ctrl/Cmd+O to load, and Ctrl/Cmd+Enter to generate.</li>
          <li>Generate builds C and L_inv; Copy copies the Python snippet.</li>
          <li>Save and Load store the drawing as a cQEDraw JSON project.</li>
        </ol>
      </section>
    </div>
  );
}

function handleDialogKeyDown(
  event: KeyboardEvent<HTMLElement>,
  dialogElement: HTMLElement | null,
  onEscape: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }

  if (event.key !== "Tab" || !dialogElement) {
    return;
  }

  const focusable = Array.from(
    dialogElement.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled"));

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function GroundIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M12 4v7" />
      <path d="M6 11h12" />
      <path d="M8 15h8" />
      <path d="M10 19h4" />
    </svg>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  shortcut,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const tooltipLabel = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      aria-label={label}
      className="icon-button"
      title={tooltipLabel}
      type="button"
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function InlineEdgeValueEditor({
  capInputRef,
  edge,
  editorRef,
  position,
  onClose,
  onValueChange,
}: {
  capInputRef: Ref<HTMLInputElement>;
  edge: CircuitEdge;
  editorRef: Ref<HTMLDivElement>;
  position: InlineEdgeEditorPosition;
  onClose: () => void;
  onValueChange: (
    edgeId: number,
    values: {
      capacitanceText?: string | null;
      inductanceText?: string | null;
      josephsonInductanceText?: string | null;
    },
  ) => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <div
      aria-label="Edge values"
      className={[
        "inline-edge-editor",
        `inline-edge-editor-${position.placement}`,
      ].join(" ")}
      data-testid="inline-edge-value-editor"
      ref={editorRef}
      role="group"
      style={{
        left: `${position.leftPx}px`,
        top: `${position.topPx}px`,
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label>
        <span>C</span>
        <input
          aria-label="Inline capacitance"
          data-testid="inline-cap-input"
          ref={capInputRef}
          value={edge.capacitance_text ?? ""}
          onChange={(event) =>
            onValueChange(edge.identifier, {
              capacitanceText: event.target.value,
            })
          }
        />
      </label>
      <label>
        <span>L</span>
        <input
          aria-label="Inline inductance"
          data-testid="inline-ind-input"
          value={edge.inductance_text ?? ""}
          onChange={(event) =>
            onValueChange(edge.identifier, {
              inductanceText: event.target.value,
            })
          }
        />
      </label>
      <label>
        <span>LJ</span>
        <input
          aria-label="Inline Josephson inductance"
          data-testid="inline-jj-ind-input"
          value={edge.josephson_inductance_text ?? ""}
          onChange={(event) =>
            onValueChange(edge.identifier, {
              josephsonInductanceText: event.target.value,
            })
          }
        />
      </label>
    </div>
  );
}

function ToolButton({
  active = false,
  buttonRef,
  confirmation,
  disabled = false,
  highlight = false,
  icon,
  iconOnly = true,
  label,
  onClick,
  shortcut,
}: {
  active?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  confirmation?: string;
  disabled?: boolean;
  highlight?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const tooltipLabel = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      aria-label={label}
      className={[
        "tool-button",
        iconOnly ? "tool-button-icon-only" : "tool-button-with-label",
        active ? "active" : "",
        highlight ? "tutorial-highlight" : "",
      ].join(" ")}
      disabled={disabled}
      ref={buttonRef}
      title={tooltipLabel}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className={iconOnly ? "sr-only" : "tool-button-label"}>{label}</span>
      {confirmation ? (
        <span aria-hidden="true" className="tool-button-confirmation">
          {confirmation}
        </span>
      ) : null}
      <span aria-hidden="true" className="tool-button-tooltip">
        {tooltipLabel}
      </span>
    </button>
  );
}

function CircuitEdgeShape({
  edge,
  nodes,
  selected,
  onGroundPointerDown,
  onPointerDown,
}: {
  edge: CircuitEdge;
  nodes: CircuitNode[];
  selected: boolean;
  onGroundPointerDown: (
    event: PointerEvent<SVGGElement>,
    edgeId: number,
  ) => void;
  onPointerDown: (event: PointerEvent<SVGLineElement>, edgeId: number) => void;
}) {
  const endpoints = edgeEndpoints(edge, nodes);
  if (!endpoints) {
    return null;
  }

  const { end, start } = endpoints;
  const componentKind = edgeComponentKind(edge);
  const valueLabels = edgeValueLabels(edge, start, end, componentKind);

  return (
    <g>
      <line
        data-testid={`edge-${edge.identifier}`}
        className="edge-hit-target"
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        onPointerDown={(event) => onPointerDown(event, edge.identifier)}
      />
      {componentKind === "none" ? (
        <line
          className={selected ? "edge-line selected" : "edge-line"}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
        />
      ) : (
        <EdgeComponentSymbol
          edgeId={edge.identifier}
          kind={componentKind}
          selected={selected}
          start={start}
          end={end}
        />
      )}
      {edge.is_ground ? (
        <GroundSymbol
          edgeId={edge.identifier}
          onPointerDown={onGroundPointerDown}
          rotation={groundSymbolRotation(start, end)}
          selected={selected}
          x={end.x}
          y={end.y}
        />
      ) : null}
      {valueLabels.map((valueLabel) => (
        <text
          key={valueLabel.testId}
          className="edge-label"
          data-testid={valueLabel.testId}
          textAnchor="middle"
          x={valueLabel.point.x}
          y={valueLabel.point.y}
        >
          {valueLabel.text}
        </text>
      ))}
    </g>
  );
}

function EdgeComponentSymbol({
  edgeId,
  end,
  kind,
  selected,
  start,
}: {
  edgeId: number;
  end: Point;
  kind: Exclude<EdgeComponentKind, "none">;
  selected: boolean;
  start: Point;
}) {
  const geometry = edgeGeometry(start, end);
  if (geometry.length === 0) {
    return null;
  }

  return (
    <g
      className={selected ? "edge-component-symbol selected" : "edge-component-symbol"}
      data-component-kind={kind}
      data-testid={`edge-symbol-${edgeId}`}
      transform={`translate(${geometry.center.x} ${geometry.center.y}) rotate(${geometry.angle})`}
    >
      {kind === "capacitor" ? (
        <CapacitorSymbol halfLength={geometry.length / 2} />
      ) : null}
      {kind === "inductor" ? (
        <InductorSymbol halfLength={geometry.length / 2} />
      ) : null}
      {kind === "josephson" ? (
        <JosephsonSymbol halfLength={geometry.length / 2} />
      ) : null}
      {kind === "parallel-lc" ? (
        <ParallelLcSymbol
          halfLength={geometry.length / 2}
          laneDirection={parallelLaneDirection(geometry.angle)}
        />
      ) : null}
      {kind === "parallel-cj" ||
      kind === "parallel-lj" ||
      kind === "parallel-lcj" ? (
        <ParallelComponentSymbol
          components={parallelComponentsForKind(kind)}
          halfLength={geometry.length / 2}
          laneDirection={parallelLaneDirection(geometry.angle)}
        />
      ) : null}
    </g>
  );
}

function CapacitorSymbol({ halfLength }: { halfLength: number }) {
  const symbolHalf = compactSymbolHalfLength(
    halfLength,
    CAPACITOR_SYMBOL_HALF_LENGTH,
  );
  const capacitor = capacitorGeometry(symbolHalf);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-capacitor.plateX} y2={0} />
      <line x1={capacitor.plateX} y1={0} x2={halfLength} y2={0} />
      <CapacitorPlates centerY={0} geometry={capacitor} />
    </>
  );
}

function InductorSymbol({ halfLength }: { halfLength: number }) {
  const coil = inductorGeometry(halfLength, INDUCTOR_SYMBOL_HALF_LENGTH);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-coil.half} y2={0} />
      <path
        data-component-part="inductor-coil"
        d={inductorPath(-coil.half, coil.half, 0, coil.radius)}
      />
      <line x1={coil.half} y1={0} x2={halfLength} y2={0} />
    </>
  );
}

function JosephsonSymbol({ halfLength }: { halfLength: number }) {
  const armHalf = Math.min(compactSymbolHalfLength(halfLength, 16), 12);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={halfLength} y2={0} />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={-armHalf}
        x2={armHalf}
        y2={armHalf}
      />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={armHalf}
        x2={armHalf}
        y2={-armHalf}
      />
    </>
  );
}

function ParallelLcSymbol({
  halfLength,
  laneDirection,
}: {
  halfLength: number;
  laneDirection: number;
}) {
  const junctionX = compactSymbolHalfLength(
    halfLength,
    PARALLEL_LC_SYMBOL_HALF_LENGTH,
  );
  const capacitor = capacitorGeometry(
    Math.min(
      junctionX,
      compactSymbolHalfLength(halfLength, CAPACITOR_SYMBOL_HALF_LENGTH),
    ),
  );
  const coil = inductorGeometry(junctionX, junctionX * 0.72, 10);
  const branchY = parallelBranchOffset(halfLength, capacitor, coil.radius);
  const capacitorY = -branchY * laneDirection;
  const inductorY = branchY * laneDirection;
  const firstY = Math.min(capacitorY, inductorY);
  const lastY = Math.max(capacitorY, inductorY);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-junctionX} y2={0} />
      <line x1={junctionX} y1={0} x2={halfLength} y2={0} />
      <line x1={-junctionX} y1={firstY} x2={-junctionX} y2={lastY} />
      <line x1={junctionX} y1={firstY} x2={junctionX} y2={lastY} />

      <line x1={-junctionX} y1={capacitorY} x2={-capacitor.plateX} y2={capacitorY} />
      <line x1={capacitor.plateX} y1={capacitorY} x2={junctionX} y2={capacitorY} />
      <CapacitorPlates centerY={capacitorY} geometry={capacitor} />

      <line x1={-junctionX} y1={inductorY} x2={-coil.half} y2={inductorY} />
      <path
        data-component-part="inductor-coil"
        d={inductorPath(-coil.half, coil.half, inductorY, coil.radius)}
      />
      <line x1={coil.half} y1={inductorY} x2={junctionX} y2={inductorY} />
    </>
  );
}

function ParallelComponentSymbol({
  components,
  halfLength,
  laneDirection,
}: {
  components: ParallelComponent[];
  halfLength: number;
  laneDirection: number;
}) {
  const junctionX = compactSymbolHalfLength(
    halfLength,
    PARALLEL_LC_SYMBOL_HALF_LENGTH,
  );
  const branchY = parallelComponentBranchOffset(halfLength, components.length);
  const branchYs = branchOffsets(components.length, branchY).map(
    (offset) => offset * laneDirection,
  );
  const firstY = branchYs[0] ?? 0;
  const lastY = branchYs[branchYs.length - 1] ?? 0;

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-junctionX} y2={0} />
      <line x1={junctionX} y1={0} x2={halfLength} y2={0} />
      <line x1={-junctionX} y1={firstY} x2={-junctionX} y2={lastY} />
      <line x1={junctionX} y1={firstY} x2={junctionX} y2={lastY} />
      {components.map((component, index) => (
        <ParallelComponentBranch
          component={component}
          key={component}
          junctionX={junctionX}
          y={branchYs[index] ?? 0}
        />
      ))}
    </>
  );
}

function ParallelComponentBranch({
  component,
  junctionX,
  y,
}: {
  component: ParallelComponent;
  junctionX: number;
  y: number;
}) {
  if (component === "capacitor") {
    const capacitor = parallelCapacitorGeometry(junctionX);
    return (
      <>
        <line x1={-junctionX} y1={y} x2={-capacitor.plateX} y2={y} />
        <line x1={capacitor.plateX} y1={y} x2={junctionX} y2={y} />
        <CapacitorPlates centerY={y} geometry={capacitor} />
      </>
    );
  }

  if (component === "inductor") {
    const coil = inductorGeometry(junctionX, junctionX * 0.62, 8);
    return (
      <>
        <line x1={-junctionX} y1={y} x2={-coil.half} y2={y} />
        <path
          data-component-part="inductor-coil"
          d={inductorPath(-coil.half, coil.half, y, coil.radius)}
        />
        <line x1={coil.half} y1={y} x2={junctionX} y2={y} />
      </>
    );
  }

  const armHalf = Math.min(compactSymbolHalfLength(junctionX, 14), 10);
  return (
    <>
      <line x1={-junctionX} y1={y} x2={junctionX} y2={y} />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={y - armHalf}
        x2={armHalf}
        y2={y + armHalf}
      />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={y + armHalf}
        x2={armHalf}
        y2={y - armHalf}
      />
    </>
  );
}

function CapacitorPlates({
  centerY,
  geometry,
}: {
  centerY: number;
  geometry: CapacitorGeometry;
}) {
  const y1 = centerY - geometry.plateHeight / 2;
  const y2 = centerY + geometry.plateHeight / 2;
  return (
    <>
      <line
        className="component-plate"
        data-component-part="capacitor-plate"
        x1={-geometry.plateX}
        y1={y1}
        x2={-geometry.plateX}
        y2={y2}
      />
      <line
        className="component-plate"
        data-component-part="capacitor-plate"
        x1={geometry.plateX}
        y1={y1}
        x2={geometry.plateX}
        y2={y2}
      />
    </>
  );
}

interface CapacitorGeometry {
  plateX: number;
  plateHeight: number;
}

function capacitorGeometry(symbolHalf: number): CapacitorGeometry {
  return {
    plateX: clampedSymbolInset(symbolHalf * 0.36, symbolHalf, 3),
    plateHeight: clamp(symbolHalf * 1.35, Math.min(10, symbolHalf), 34),
  };
}

function parallelCapacitorGeometry(junctionX: number): CapacitorGeometry {
  const capacitor = capacitorGeometry(
    Math.min(junctionX, compactSymbolHalfLength(junctionX, CAPACITOR_SYMBOL_HALF_LENGTH)),
  );
  return {
    ...capacitor,
    plateHeight: clamp(capacitor.plateHeight, 8, 26),
  };
}

function inductorGeometry(
  halfLength: number,
  preferredHalf: number,
  maxRadius = 14,
) {
  const coilHalf = compactSymbolHalfLength(halfLength, preferredHalf);
  return {
    half: coilHalf,
    radius: clamp(coilHalf * 0.34, Math.min(4, coilHalf * 0.5), maxRadius),
  };
}

function parallelBranchOffset(
  halfLength: number,
  capacitor: CapacitorGeometry,
  coilRadius: number,
): number {
  const maxBranchY = Math.max(
    1,
    halfLength - Math.max(capacitor.plateHeight / 2, coilRadius),
  );
  const preferredBranchY = Math.min(
    18,
    Math.max(capacitor.plateHeight / 2 + 8, coilRadius + 8),
  );
  return clamp(
    preferredBranchY,
    Math.min(4, maxBranchY),
    maxBranchY,
  );
}

function parallelComponentBranchOffset(
  halfLength: number,
  componentCount: number,
): number {
  const maxBranchY = Math.max(1, halfLength - 12);
  const preferredBranchY = componentCount > 2 ? 30 : 24;
  return clamp(preferredBranchY, Math.min(6, maxBranchY), maxBranchY);
}

function parallelLaneDirection(angle: number): number {
  const radians = (angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  if (Math.abs(sin) > 0.001) {
    return sin < 0 ? 1 : -1;
  }
  return Math.cos(radians) >= 0 ? 1 : -1;
}

function branchOffsets(componentCount: number, branchY: number): number[] {
  if (componentCount <= 1) {
    return [0];
  }
  if (componentCount === 2) {
    return [-branchY, branchY];
  }
  return [-branchY, 0, branchY];
}

function parallelComponentsForKind(kind: EdgeComponentKind): ParallelComponent[] {
  if (kind === "parallel-cj") {
    return ["capacitor", "josephson"];
  }
  if (kind === "parallel-lj") {
    return ["inductor", "josephson"];
  }
  if (kind === "parallel-lcj") {
    return ["capacitor", "inductor", "josephson"];
  }
  return [];
}

function compactSymbolHalfLength(halfLength: number, preferred: number): number {
  const wireGap = Math.min(10, halfLength * 0.25);
  return Math.min(preferred, Math.max(1, halfLength - wireGap));
}

function clampedSymbolInset(
  preferred: number,
  halfLength: number,
  minimum: number,
): number {
  const maxInset = Math.max(halfLength - 2, halfLength * 0.5);
  return clamp(preferred, Math.min(minimum, maxInset), maxInset);
}

function inductorPath(
  startX: number,
  endX: number,
  centerY: number,
  radius: number,
): string {
  const loopCount = 4;
  const loopWidth = (endX - startX) / loopCount;
  const radiusX = loopWidth / 2;
  const segments = [`M ${startX} ${centerY}`];
  for (let index = 0; index < loopCount; index += 1) {
    const x1 = startX + loopWidth * (index + 1);
    segments.push(`A ${radiusX} ${radius} 0 0 1 ${x1} ${centerY}`);
  }
  return segments.join(" ");
}

function GroundSymbol({
  edgeId,
  onPointerDown,
  rotation,
  selected,
  x,
  y,
}: {
  edgeId: number;
  onPointerDown: (event: PointerEvent<SVGGElement>, edgeId: number) => void;
  rotation: number;
  selected: boolean;
  x: number;
  y: number;
}) {
  return (
    <g
      className={selected ? "ground-symbol selected" : "ground-symbol"}
      data-testid={`ground-symbol-${edgeId}`}
      onPointerDown={(event) => onPointerDown(event, edgeId)}
      transform={`translate(${x} ${y}) rotate(${rotation})`}
    >
      <circle className="ground-symbol-hit-target" cx={0} cy={10} r={28} />
      <line x1={-18} y1={0} x2={18} y2={0} />
      <line x1={-12} y1={10} x2={12} y2={10} />
      <line x1={-6} y1={20} x2={6} y2={20} />
    </g>
  );
}

function groundSymbolRotation(start: Point, end: Point): number {
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI - 90;
}

function PastePreview({
  anchor,
  clipboard,
}: {
  anchor: Point;
  clipboard: SelectionClipboard;
}) {
  const previewNodes = clipboard.nodes.map((node) => ({
    ...node,
    x: anchor.x + node.dx,
    y: anchor.y + node.dy,
  }));
  const nodesByOriginalId = new Map(
    previewNodes.map((node) => [node.id, node]),
  );

  return (
    <g className="paste-preview" data-testid="paste-preview">
      {clipboard.edges.map((edge, index) => {
        if (edge.is_ground) {
          const source = nodesByOriginalId.get(edge.nodes[0]);
          if (!source) {
            return null;
          }
          return (
            <line
              key={`ground-${index}`}
              className="paste-preview-line"
              data-testid={`paste-preview-edge-${index}`}
              x1={source.x}
              y1={source.y}
              x2={source.x + edge.ground_offset_x}
              y2={source.y + edge.ground_offset_y}
            />
          );
        }

        const first = nodesByOriginalId.get(edge.nodes[0]);
        const second = nodesByOriginalId.get(edge.nodes[1]);
        if (!first || !second) {
          return null;
        }
        return (
          <line
            key={`edge-${index}`}
            className="paste-preview-line"
            data-testid={`paste-preview-edge-${index}`}
            x1={first.x}
            y1={first.y}
            x2={second.x}
            y2={second.y}
          />
        );
      })}
      {previewNodes.map((node) => (
        <g key={node.id}>
          <circle
            className="paste-preview-node"
            data-testid={`paste-preview-node-${node.id}`}
            cx={node.x}
            cy={node.y}
            r={NODE_RADIUS}
          />
          <text className="paste-preview-label" x={node.x + 16} y={node.y + 5}>
            {node.name}
          </text>
        </g>
      ))}
    </g>
  );
}

function ConcatenatePreview({
  bridges,
}: {
  bridges: ConcatenatePreviewBridge[];
}) {
  return (
    <g className="concatenate-preview" data-testid="concatenate-preview">
      {bridges.map((bridge, index) => (
        <g
          data-left-node-id={bridge.leftNodeId}
          data-right-node-id={bridge.rightNodeId}
          data-testid={`concatenate-preview-bridge-${index}`}
          key={`${bridge.leftNodeId}-${bridge.rightNodeId}-${index}`}
        >
          <line
            className="concatenate-preview-line"
            x1={bridge.x1}
            y1={bridge.y1}
            x2={bridge.x2}
            y2={bridge.y2}
          />
          <circle
            className="concatenate-preview-port"
            cx={bridge.x2}
            cy={bridge.y2}
            r={NODE_RADIUS}
          />
        </g>
      ))}
    </g>
  );
}

function EngineWarmupBadge({ warmup }: { warmup: EngineWarmupState }) {
  const { className, label, title } = engineWarmupBadgeState(warmup);
  return (
    <span
      className={["engine-warmup-badge", className].join(" ")}
      data-testid="engine-warmup-status"
      title={title}
    >
      {label}
    </span>
  );
}

function engineWarmupBadgeState(warmup: EngineWarmupState) {
  if (warmup.base === "warming") {
    return {
      className: "engine-warmup-badge-warming",
      label: "Python warming",
      title: "Pyodide and symbolic matrix dependencies are loading in the background.",
    };
  }
  if (warmup.base === "error") {
    return {
      className: "engine-warmup-badge-error",
      label: "Python on demand",
      title: `Background Python preload failed. Generate will retry. ${warmup.error ?? ""}`,
    };
  }
  if (warmup.analysis === "warming") {
    return {
      className: "engine-warmup-badge-warming",
      label: "BBQ warming",
      title: "The matrix engine is ready; BBQ analysis dependencies are loading in the background.",
    };
  }
  if (warmup.analysis === "ready") {
    return {
      className: "engine-warmup-badge-ready",
      label: "Analysis ready",
      title: "Pyodide, matrix generation, and BBQ analysis dependencies are ready.",
    };
  }
  if (warmup.analysis === "error") {
    return {
      className: "engine-warmup-badge-error",
      label: "BBQ on demand",
      title: `Background BBQ preload failed. Analyze modes will retry. ${warmup.error ?? ""}`,
    };
  }
  if (warmup.base === "ready") {
    return {
      className: "engine-warmup-badge-ready",
      label: "Matrices ready",
      title: "Pyodide and symbolic matrix dependencies are ready.",
    };
  }
  return {
    className: "",
    label: "Python idle",
    title: "The Python worker has not started yet.",
  };
}

function EntryList({
  title,
  testId,
  entries,
}: {
  title: string;
  testId: string;
  entries: { row: number; col: number; expr: string }[];
}) {
  return (
    <div className="entries">
      <h3>{title}</h3>
      <ol data-testid={testId}>
        {entries.map((entry) => (
          <li key={`${entry.row}-${entry.col}`}>
            ({entry.row}, {entry.col}) = {entry.expr}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MatrixNodeList({ nodes }: { nodes: OutputResult["matrix_nodes"] }) {
  return (
    <div className="entries">
      <h3>Matrix nodes</h3>
      <ol data-testid="matrix-nodes">
        {nodes.map((node) => (
          <li key={node.project_node_id}>
            {node.matrix_index}: {node.name ?? `node ${node.project_node_id}`}{" "}
            (project node {node.project_node_id})
          </li>
        ))}
      </ol>
    </div>
  );
}

function JosephsonBranchList({
  branches,
}: {
  branches: OutputResult["josephson_branches"];
}) {
  return (
    <div className="entries">
      <h3>Josephson branches</h3>
      <ol data-testid="jj-branches">
        {branches.map((branch) => (
          <li key={branch.edge_id ?? `${branch.project_nodes[0]}-${branch.project_nodes[1]}`}>
            edge {branch.edge_id}: phase index {branch.phase_positive_index ?? "GND"} -{" "}
            {branch.phase_negative_index ?? "GND"}, LJ = {branch.inductance_expr}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ParameterValuePanel({
  disabled,
  onAnalyze,
  onChange,
  onExport,
  parameters,
  values,
}: {
  disabled: boolean;
  onAnalyze: () => void;
  onChange: (name: string, value: string) => void;
  onExport: () => void;
  parameters: string[];
  values: Record<string, string>;
}) {
  return (
    <div className="parameter-panel">
      <div className="parameter-panel-heading">
        <h3>Parameter values</h3>
        <div className="parameter-panel-actions">
          <button
            disabled={disabled}
            onClick={onAnalyze}
            type="button"
          >
            <Play size={14} />
            Analyze modes
          </button>
          <button
            disabled={disabled}
            onClick={onExport}
            type="button"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>
      {parameters.length === 0 ? (
        <p data-testid="parameter-empty">No parameters.</p>
      ) : (
        <div className="parameter-grid" data-testid="parameter-values">
          {parameters.map((name) => (
            <label key={name}>
              <span>{name}</span>
              <input
                aria-label={`Value for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onChange(name, event.target.value)}
                placeholder="0"
                value={values[name] ?? ""}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ModalAnalysisTable({ result }: { result: ModalAnalysisResult | null }) {
  if (!result?.available) {
    return null;
  }

  const frequencies = result.frequencies_ghz ?? [];
  const branches = result.branches ?? [];
  const hasJosephsonRows = branches.length > 0;
  return (
    <div className="modal-analysis" data-testid="modal-analysis">
      <h3>BBQ modal results</h3>
      <div className="modal-analysis-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quantity</th>
              {frequencies.map((_, index) => (
                <th key={index}>mode {index}</th>
              ))}
              {hasJosephsonRows ? <th>Ej GHz</th> : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>frequency GHz</th>
              {frequencies.map((frequency, index) => (
                <td key={index}>{formatModalNumber(frequency)}</td>
              ))}
              {hasJosephsonRows ? <td /> : null}
            </tr>
            {branches.map((branch, branchIndex) => (
              <tr key={branch.edge_id ?? branchIndex}>
                <th>
                  edge {branch.edge_id ?? branchIndex} phase{" "}
                  {branch.phase_nodes[0] ?? "GND"} - {branch.phase_nodes[1] ?? "GND"}
                </th>
                {branch.phase_zpf.map((zpf, modeIndex) => (
                  <td key={modeIndex}>{formatModalNumber(zpf)}</td>
                ))}
                <td>{formatModalNumber(branch.E_j_GHz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatModalNumber(value: number): string {
  if (value === 0) {
    return "0";
  }
  const absValue = Math.abs(value);
  if (absValue < 1e-3 || absValue >= 1e4) {
    return value.toExponential(4);
  }
  return value.toPrecision(6);
}

function downloadCsv(filename: string, columns: string[], rows: number[][]) {
  const csv = [
    columns.map(formatCsvCell).join(","),
    ...rows.map((row) => row.map(formatCsvCell).join(",")),
  ].join("\n");
  const blob = new Blob([`${csv}\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatCsvCell(value: number | string): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function svgPoint(event: PointerEvent<SVGSVGElement>) {
  return svgPointFromClient(event.currentTarget, event.clientX, event.clientY);
}

function svgPointFromClient(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function edgeEndpoints(edge: CircuitEdge, nodes: CircuitNode[]) {
  const first = nodes.find((node) => node.identifier === edge.nodes[0]);
  const second =
    edge.nodes[1] === GROUND_NODE_ID
      ? null
      : nodes.find((node) => node.identifier === edge.nodes[1]);
  if (!first || (!second && !edge.is_ground)) {
    return null;
  }

  return {
    end: {
      x: edge.is_ground ? first.x + edge.ground_offset_x : second!.x,
      y: edge.is_ground ? first.y + edge.ground_offset_y : second!.y,
    },
    start: { x: first.x, y: first.y },
  };
}

function josephsonPhaseLabel(
  edge: CircuitEdge,
  matrixNodeLabels: Map<number, string>,
): string {
  const first = matrixNodeLabels.get(edge.nodes[0]) ?? String(edge.nodes[0]);
  const second =
    edge.nodes[1] === GROUND_NODE_ID
      ? "GND"
      : matrixNodeLabels.get(edge.nodes[1]) ?? String(edge.nodes[1]);
  const positive =
    edge.josephson_phase_sign === -1
      ? edge.is_ground
        ? "GND"
        : first
      : edge.is_ground
        ? first
        : second;
  const negative =
    edge.josephson_phase_sign === -1
      ? edge.is_ground
        ? first
        : second
      : edge.is_ground
        ? "GND"
        : first;
  return `Phase: ${positive} - ${negative}`;
}

function matrixNodeLabelMap(nodes: CircuitNode[]): Map<number, string> {
  return new Map(
    [...nodes]
      .sort((first, second) => first.identifier - second.identifier)
      .map((node, index) => [node.identifier, String(index)]),
  );
}

function inlineEdgeEditorPosition(
  edge: CircuitEdge,
  nodes: CircuitNode[],
  canvas: SVGSVGElement | null,
  stage: HTMLDivElement | null,
): InlineEdgeEditorPosition | null {
  if (!canvas || !stage) {
    return null;
  }
  const endpoints = edgeEndpoints(edge, nodes);
  if (!endpoints) {
    return null;
  }
  const geometry = edgeGeometry(endpoints.start, endpoints.end);
  if (geometry.length === 0) {
    return null;
  }

  const anchor = localEdgePoint(geometry, {
    x: 0,
    y: edge.is_ground
      ? INLINE_GROUND_EDITOR_OFFSET
      : -INLINE_EDGE_EDITOR_OFFSET,
  });
  const matrix = canvas.getScreenCTM();
  if (!matrix) {
    return null;
  }

  const point = canvas.createSVGPoint();
  point.x = anchor.x;
  point.y = anchor.y;
  const screenPoint = point.matrixTransform(matrix);
  const stageRect = stage.getBoundingClientRect();
  const topPx = screenPoint.y - stageRect.top;
  return {
    leftPx: screenPoint.x - stageRect.left,
    placement: topPx < INLINE_EDITOR_ABOVE_THRESHOLD_PX ? "below" : "above",
    topPx,
  };
}

function edgeComponentKind(edge: CircuitEdge): EdgeComponentKind {
  const hasCapacitance = Boolean(edge.capacitance_text?.trim());
  const hasInductance = Boolean(edge.inductance_text?.trim());
  const hasJosephson = Boolean(edge.josephson_inductance_text?.trim());
  if (hasCapacitance && hasInductance && hasJosephson) {
    return "parallel-lcj";
  }
  if (hasCapacitance && hasInductance) {
    return "parallel-lc";
  }
  if (hasCapacitance && hasJosephson) {
    return "parallel-cj";
  }
  if (hasInductance && hasJosephson) {
    return "parallel-lj";
  }
  if (hasCapacitance) {
    return "capacitor";
  }
  if (hasInductance) {
    return "inductor";
  }
  if (hasJosephson) {
    return "josephson";
  }
  return "none";
}

function edgeGeometry(start: Point, end: Point) {
  const rawDx = end.x - start.x;
  const rawDy = end.y - start.y;
  const shouldFlipDirection = rawDx < 0 || (Math.abs(rawDx) < 0.001 && rawDy > 0);
  const dx = shouldFlipDirection ? -rawDx : rawDx;
  const dy = shouldFlipDirection ? -rawDy : rawDy;
  const length = Math.hypot(dx, dy);
  return {
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    center: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    dx,
    dy,
    length,
  };
}

function edgeValueLabels(
  edge: CircuitEdge,
  start: Point,
  end: Point,
  componentKind: EdgeComponentKind,
) {
  const capacitanceText = edge.capacitance_text?.trim();
  const inductanceText = edge.inductance_text?.trim();
  const josephsonInductanceText = edge.josephson_inductance_text?.trim();
  if (componentKind === "none") {
    return [];
  }

  const geometry = edgeGeometry(start, end);
  if (geometry.length === 0) {
    return [];
  }

  if (componentKind === "parallel-lc") {
    const laneDirection = parallelLaneDirection(geometry.angle);
    const capacitorY = -54 * laneDirection;
    const inductorY = 62 * laneDirection;
    return [
      ...(capacitanceText
        ? [
            {
              point: localEdgePoint(geometry, { x: 0, y: capacitorY }),
              testId: `edge-value-cap-${edge.identifier}`,
              text: `C=${capacitanceText}`,
            },
          ]
        : []),
      ...(inductanceText
        ? [
            {
              point: localEdgePoint(geometry, { x: 0, y: inductorY }),
              testId: `edge-value-ind-${edge.identifier}`,
              text: `L=${inductanceText}`,
            },
          ]
        : []),
    ];
  }

  if (
    componentKind === "parallel-cj" ||
    componentKind === "parallel-lj" ||
    componentKind === "parallel-lcj"
  ) {
    const components = parallelComponentsForKind(componentKind);
    const branchY = parallelComponentBranchOffset(geometry.length / 2, components.length);
    const branchYs = branchOffsets(components.length, branchY).map(
      (offset) => offset * parallelLaneDirection(geometry.angle),
    );
    const componentYs = new Map(
      components.map((component, index) => [component, branchYs[index] ?? 0]),
    );
    const symbolHalf = compactSymbolHalfLength(
      geometry.length / 2,
      PARALLEL_LC_SYMBOL_HALF_LENGTH,
    );
    const labelX = Math.min(
      geometry.length / 2 + 18,
      Math.max(56, symbolHalf + 34),
    );
    const labelY = (componentY: number) => componentY + (componentY > 0 ? 18 : -14);
    const labels = [];
    const capacitorY = componentYs.get("capacitor");
    const inductorY = componentYs.get("inductor");
    const josephsonY = componentYs.get("josephson");
    if (capacitanceText) {
      const y = capacitorY ?? -branchY;
      labels.push({
        point: localEdgePoint(geometry, { x: labelX, y: labelY(y) }),
        testId: `edge-value-cap-${edge.identifier}`,
        text: `C=${capacitanceText}`,
      });
    }
    if (inductanceText) {
      const y = inductorY ?? branchY;
      labels.push({
        point: localEdgePoint(geometry, { x: labelX, y: labelY(y) }),
        testId: `edge-value-ind-${edge.identifier}`,
        text: `L=${inductanceText}`,
      });
    }
    if (josephsonInductanceText) {
      const y = josephsonY ?? branchY;
      labels.push({
        point: localEdgePoint(geometry, { x: labelX, y: labelY(y) }),
        testId: `edge-value-jj-${edge.identifier}`,
        text: `LJ=${josephsonInductanceText}`,
      });
    }
    return labels;
  }

  const valueText =
    componentKind === "capacitor"
      ? capacitanceText
      : componentKind === "josephson"
        ? josephsonInductanceText
        : inductanceText;
  if (!valueText) {
    return [];
  }

  return [
    {
      point: localEdgePoint(geometry, { x: 0, y: -44 }),
      testId:
        componentKind === "capacitor"
          ? `edge-value-cap-${edge.identifier}`
          : componentKind === "josephson"
            ? `edge-value-jj-${edge.identifier}`
            : `edge-value-ind-${edge.identifier}`,
      text: `${
        componentKind === "capacitor"
          ? "C"
          : componentKind === "josephson"
            ? "LJ"
            : "L"
      }=${valueText}`,
    },
  ];
}

function localEdgePoint(
  geometry: ReturnType<typeof edgeGeometry>,
  localPoint: Point,
): Point {
  const angle = (geometry.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: geometry.center.x + localPoint.x * cos - localPoint.y * sin,
    y: geometry.center.y + localPoint.x * sin + localPoint.y * cos,
  };
}

function viewBoxToString(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

function gridRectForView(viewBox: ViewBox): ViewBox {
  return {
    x: viewBox.x - GRID_VIEW_MARGIN,
    y: viewBox.y - GRID_VIEW_MARGIN,
    width: viewBox.width + GRID_VIEW_MARGIN * 2,
    height: viewBox.height + GRID_VIEW_MARGIN * 2,
  };
}

function serializeProjectForDirtyCheck(project: CircuitProject): string {
  return JSON.stringify(project);
}

function projectsMatch(first: CircuitProject, second: CircuitProject): boolean {
  return (
    serializeProjectForDirtyCheck(first) === serializeProjectForDirtyCheck(second)
  );
}

function selectionStatusMessage(nodeCount: number): string {
  return nodeCount === 0
    ? "Selection cleared."
    : `Selected ${nodeCount} node${nodeCount === 1 ? "" : "s"}.`;
}

function deletionStatusMessage(nodeCount: number, connectionCount: number): string {
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

function appendProjectHistoryEntry(
  history: CircuitProject[],
  project: CircuitProject,
): CircuitProject[] {
  const latest = history[history.length - 1];
  if (latest && projectsMatch(latest, project)) {
    return history;
  }
  return [...history, project].slice(-PROJECT_HISTORY_LIMIT);
}

function shouldIgnoreAppShortcut(
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

function clampNodeDragDeltaToView(
  nodePositions: NodeDragPosition[],
  deltaX: number,
  deltaY: number,
  viewBox: ViewBox,
): Point {
  if (nodePositions.length === 0) {
    return { x: deltaX, y: deltaY };
  }

  const inset = NODE_RADIUS + 4;
  const minX = Math.min(...nodePositions.map((node) => node.x));
  const maxX = Math.max(...nodePositions.map((node) => node.x));
  const minY = Math.min(...nodePositions.map((node) => node.y));
  const maxY = Math.max(...nodePositions.map((node) => node.y));
  return {
    x: clamp(
      deltaX,
      viewBox.x + inset - minX,
      viewBox.x + viewBox.width - inset - maxX,
    ),
    y: clamp(
      deltaY,
      viewBox.y + inset - minY,
      viewBox.y + viewBox.height - inset - maxY,
    ),
  };
}

function moveDraggedNodes(
  project: CircuitProject,
  nodePositions: NodeDragPosition[],
  deltaX: number,
  deltaY: number,
): CircuitProject {
  const positionsById = new Map(
    nodePositions.map((node) => [node.identifier, node]),
  );
  return {
    ...project,
    state: {
      ...project.state,
      nodes: project.state.nodes.map((node) => {
        const start = positionsById.get(node.identifier);
        return start
          ? { ...node, x: start.x + deltaX, y: start.y + deltaY }
          : node;
      }),
    },
  };
}

function clipboardFromSelection(
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

function pasteSelectionClipboard(
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

function rectFromPoints(start: Point, end: Point): ViewBox {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(start.x, end.x) - x,
    height: Math.max(start.y, end.y) - y,
  };
}

function nodeIdsInsideRect(nodes: CircuitNode[], rect: ViewBox): number[] {
  return nodes
    .filter((node) =>
      node.x >= rect.x &&
      node.x <= rect.x + rect.width &&
      node.y >= rect.y &&
      node.y <= rect.y + rect.height,
    )
    .map((node) => node.identifier);
}

function zoomViewBox(
  viewBox: ViewBox,
  factor: number,
  anchor: { x: number; y: number } = {
    x: viewBox.x + viewBox.width / 2,
    y: viewBox.y + viewBox.height / 2,
  },
): ViewBox {
  const nextWidth = clamp(viewBox.width * factor, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
  const nextHeight = nextWidth * (CANVAS_HEIGHT / CANVAS_WIDTH);
  const actualFactor = nextWidth / viewBox.width;
  return {
    x: anchor.x - (anchor.x - viewBox.x) * actualFactor,
    y: anchor.y - (anchor.y - viewBox.y) * actualFactor,
    width: nextWidth,
    height: nextHeight,
  };
}

function normalizeWheelDelta(
  event: Pick<globalThis.WheelEvent, "deltaMode" | "deltaY">,
): number {
  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    return event.deltaY * CANVAS_HEIGHT;
  }
  return event.deltaY;
}

function fitProjectView(project: CircuitProject): ViewBox {
  const points = project.state.nodes.map((node) => ({ x: node.x, y: node.y }));
  for (const edge of project.state.edges) {
    if (!edge.is_ground) {
      continue;
    }
    const node = project.state.nodes.find(
      (candidate) => candidate.identifier === edge.nodes[0],
    );
    if (node) {
      points.push({
        x: node.x + edge.ground_offset_x,
        y: node.y + edge.ground_offset_y,
      });
    }
  }

  if (points.length === 0) {
    return DEFAULT_VIEW_BOX;
  }

  const minX = Math.min(...points.map((point) => point.x)) - FIT_VIEW_MARGIN;
  const maxX = Math.max(...points.map((point) => point.x)) + FIT_VIEW_MARGIN;
  const minY = Math.min(...points.map((point) => point.y)) - FIT_VIEW_MARGIN;
  const maxY = Math.max(...points.map((point) => point.y)) + FIT_VIEW_MARGIN;
  const contentWidth = Math.max(maxX - minX, CANVAS_WIDTH);
  const contentHeight = Math.max(maxY - minY, CANVAS_HEIGHT);
  const canvasRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
  const contentRatio = contentWidth / contentHeight;
  let width = contentWidth;
  let height = contentHeight;

  if (contentRatio > canvasRatio) {
    height = width / canvasRatio;
  } else {
    width = height * canvasRatio;
  }

  width = Math.min(width, MAX_VIEW_WIDTH);
  height = width * (CANVAS_HEIGHT / CANVAS_WIDTH);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const TUTORIAL_STEPS: Record<TutorialStep, { progress: string; title: string; body: string }> = {
  welcome: {
    progress: "Tutorial",
    title: "Build a small circuit",
    body:
      "This walkthrough creates two nodes, one edge, one ground reference, " +
      "and a Python snippet. You can skip it anytime.",
  },
  "first-node": {
    progress: "Step 1 of 11",
    title: "Place the first node",
    body: "Use Node mode and click the canvas to place the first circuit node.",
  },
  "second-node": {
    progress: "Step 2 of 11",
    title: "Place the second node",
    body: "Click another point on the canvas to place a second node.",
  },
  "edge-mode": {
    progress: "Step 3 of 11",
    title: "Switch to Edge",
    body: "Click Edge in the toolbar so the next node clicks create a connection.",
  },
  "connect-edge": {
    progress: "Step 4 of 11",
    title: "Connect the nodes",
    body: "Click the first node, then click the second node to create one edge between them.",
  },
  "edge-values": {
    progress: "Step 5 of 11",
    title: "Enter edge values",
    body: "With the edge selected, enter C for Capacitance and L for Linear inductance.",
  },
  "ground-mode": {
    progress: "Step 6 of 11",
    title: "Switch to Ground",
    body: "Click Ground in the toolbar to add a reference connection.",
  },
  "add-ground": {
    progress: "Step 7 of 11",
    title: "Add the ground reference",
    body: "Click the second node to attach a ground reference to it.",
  },
  "ground-values": {
    progress: "Step 8 of 11",
    title: "Enter ground capacitance",
    body: "For this tutorial, enter Cg for Capacitance and leave Linear inductance empty.",
  },
  "edit-edge": {
    progress: "Step 9 of 11",
    title: "Edit existing values",
    body: "Click the edge between the two nodes again. Its C and L values reopen in the Inspector for editing.",
  },
  generate: {
    progress: "Step 10 of 11",
    title: "Generate matrices",
    body:
      "Click Generate to build the C and L_inv entries with the same engine used " +
      "by the desktop app.",
  },
  copy: {
    progress: "Step 11 of 11",
    title: "Copy matrices",
    body: "Click Copy matrices to place the generated Python matrix snippet on the clipboard.",
  },
  finish: {
    progress: "Done",
    title: "Tutorial complete",
    body: "Use Save and Load in the toolbar to store and reopen cQEDraw JSON projects.",
  },
};

function nextTutorialStep({
  mode,
  output,
  project,
  selectedEdgeId,
  step,
  tutorialCopied,
}: {
  mode: ToolMode;
  output: OutputResult | null;
  project: CircuitProject;
  selectedEdgeId: number | null;
  step: TutorialStep;
  tutorialCopied: boolean;
}): TutorialStep | null {
  const regularEdge = project.state.edges.find((edge) => !edge.is_ground);
  const groundEdge = project.state.edges.find((edge) => edge.is_ground);

  switch (step) {
    case "first-node":
      return project.state.nodes.length >= 1 ? "second-node" : null;
    case "second-node":
      return project.state.nodes.length >= 2 ? "edge-mode" : null;
    case "edge-mode":
      return mode === "edge" ? "connect-edge" : null;
    case "connect-edge":
      return regularEdge ? "edge-values" : null;
    case "edge-values":
      return hasEdgeValues(regularEdge) ? "ground-mode" : null;
    case "ground-mode":
      return mode === "ground" ? "add-ground" : null;
    case "add-ground":
      return groundEdge ? "ground-values" : null;
    case "ground-values":
      return hasCapacitanceValue(groundEdge) ? "edit-edge" : null;
    case "edit-edge":
      return regularEdge && selectedEdgeId === regularEdge.identifier ? "generate" : null;
    case "generate":
      return output ? "copy" : null;
    case "copy":
      return tutorialCopied ? "finish" : null;
    default:
      return null;
  }
}

function hasEdgeValues(edge: CircuitEdge | null | undefined): boolean {
  return Boolean(edge?.capacitance_text?.trim() && edge.inductance_text?.trim());
}

function hasCapacitanceValue(edge: CircuitEdge | null | undefined): boolean {
  return Boolean(edge?.capacitance_text?.trim());
}

function tutorialPlacement(step: TutorialStep): TutorialPlacement {
  if (step === "edge-mode" || step === "ground-mode") {
    return "tools";
  }
  if (step === "generate" || step === "copy") {
    return "actions";
  }
  if (step === "edge-values" || step === "ground-values") {
    return "inspector";
  }
  return "canvas";
}

function isTutorialDismissed(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

function rememberTutorialDismissed() {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "dismissed");
  } catch {
    // Ignore storage failures; the tutorial remains fully usable in-memory.
  }
}
