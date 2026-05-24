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
  Menu,
  MousePointer2,
  Redo2,
  Repeat2,
  Trash2,
  Undo2,
  Upload,
  X,
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
import {
  buildCurrentFrequencySeries,
  buildCurrentZpfSeries,
  buildSweepPrecomputeQueueFromParameters,
  buildSweepValues,
  canStartSweepPrecompute,
  chartBounds,
  referenceFrequencyYBounds,
  referenceZpfYBounds,
  MAX_SWEEP_POINTS,
  type ChartBounds,
  type ChartPoint,
  type ChartSeries,
  type ChartYBounds,
  type SweepSample,
  type SweepScale,
} from "./analysis";
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
const MAX_SWEEP_CACHE_ENTRIES = 160;
const MODAL_ANALYSIS_DEBOUNCE_MS = 250;
const OUTPUT_GENERATION_DEBOUNCE_MS = 250;
const SWEEP_ANALYSIS_DEBOUNCE_MS = 120;
const SWEEP_INTERACTION_IDLE_MS = 350;
const SWEEP_PRECOMPUTE_IDLE_TIMEOUT_MS = 450;

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

interface EdgeValueLabel {
  point: Point;
  testId: string;
  text: string;
}

interface EdgeInteractionZone {
  height: number;
  width: number;
  x: number;
  y: number;
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

interface ParameterSweepConfig {
  enabled: boolean;
  max: string;
  min: string;
  scale: SweepScale;
  step: string;
}

type ParameterSweepConfigs = Record<string, ParameterSweepConfig>;

interface MultiSweepValidation {
  error: string | null;
  parameterValues: Record<string, number[]>;
  precomputeLimit: number;
  parameters: string[];
  totalCombinations: number;
}

const INITIAL_ENGINE_WARMUP: EngineWarmupState = {
  base: "idle",
  analysis: "idle",
  error: null,
};

const INITIAL_PARAMETER_SWEEP_CONFIG: ParameterSweepConfig = {
  enabled: false,
  max: "",
  min: "",
  scale: "linear",
  step: "",
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
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [sweepConfig, setSweepConfig] = useState<ParameterSweepConfigs>({});
  const [sweepSamples, setSweepSamples] = useState<SweepSample[]>([]);
  const [sweepSliderValues, setSweepSliderValues] = useState<Record<string, number>>({});
  const [sweepInteractionActive, setSweepInteractionActive] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepPrecomputeRunning, setSweepPrecomputeRunning] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [outputDrawerOpen, setOutputDrawerOpen] = useState(false);
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
  const outputPanelRef = useRef<HTMLElement | null>(null);
  const clientRef = useRef<PyodideBridgeClient | null>(null);
  const analysisRequestIdRef = useRef(0);
  const outputGenerationPromiseRef = useRef<Promise<OutputResult | null> | null>(
    null,
  );
  const sweepSampleCacheRef = useRef<Map<string, SweepSample>>(new Map());
  const sweepPrecomputeContextRef = useRef(0);
  const sweepPrecomputeJobIdRef = useRef(0);
  const sweepInteractionIdleTimerRef = useRef<number | null>(null);
  const sweepRequestIdRef = useRef(0);
  const outputScrollRestoreRef = useRef<{ expiresAt: number; top: number } | null>(
    null,
  );
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

  useEffect(() => {
    if (tutorialStep === "generate" || tutorialStep === "copy") {
      setOutputDrawerOpen(true);
    }
  }, [tutorialStep]);

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
  const sweepValidation = useMemo(
    () =>
      buildMultiSweepValues(
        outputParameters,
        sweepConfig,
        MAX_SWEEP_POINTS,
      ),
    [outputParameters, sweepConfig],
  );
  const activeSweepParameters = sweepValidation.parameters;
  const selectedSweepValues = useMemo(
    () =>
      selectedValuesForSweep(
        activeSweepParameters,
        sweepValidation.parameterValues,
        sweepSliderValues,
      ),
    [activeSweepParameters, sweepSliderValues, sweepValidation.parameterValues],
  );
  const missingSweepFixedValues = useMemo(
    () =>
      outputParameters.filter(
        (name) =>
          !sweepConfig[name]?.enabled &&
          (parameterValues[name] ?? "").trim() === "",
      ),
    [outputParameters, parameterValues, sweepConfig],
  );
  const selectedSweepSample = useMemo(
    () => selectedSampleForSweepValues(sweepSamples, selectedSweepValues),
    [selectedSweepValues, sweepSamples],
  );
  const cachedSweepGridPointCount = useMemo(
    () =>
      countSweepGridSamples(
        sweepValidation.parameterValues,
        sweepSamples,
        activeSweepParameters,
      ),
    [activeSweepParameters, sweepSamples, sweepValidation.parameterValues],
  );
  const sweepModeActive =
    activeSweepParameters.length > 0 &&
    !sweepValidation.error &&
    sweepValidation.totalCombinations > 0;
  const displayedAnalysis = sweepModeActive
    ? selectedSweepSample?.analysis ?? null
    : modalAnalysis;

  useLayoutEffect(() => {
    const restore = outputScrollRestoreRef.current;
    const panel = outputPanelRef.current;
    if (!restore || !panel) {
      return;
    }
    if (performance.now() > restore.expiresAt) {
      outputScrollRestoreRef.current = null;
      return;
    }

    panel.scrollTop = restore.top;
    const animationFrame = window.requestAnimationFrame(() => {
      const activeRestore = outputScrollRestoreRef.current;
      if (!activeRestore || !outputPanelRef.current) {
        return;
      }
      if (performance.now() > activeRestore.expiresAt) {
        outputScrollRestoreRef.current = null;
        return;
      }
      outputPanelRef.current.scrollTop = activeRestore.top;
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    displayedAnalysis,
    engineStatus,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
  ]);

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

  useEffect(
    () => () => {
      if (sweepInteractionIdleTimerRef.current !== null) {
        window.clearTimeout(sweepInteractionIdleTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!output) {
      analysisRequestIdRef.current += 1;
      setModalAnalysis(null);
      setAnalysisRunning(false);
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
    setSweepConfig((current) => {
      const next: ParameterSweepConfigs = {};
      for (const name of outputParameters) {
        next[name] = current[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG;
      }
      return next;
    });
  }, [output, outputParameters]);

  useEffect(() => {
    if (
      !output ||
      outputParameters.length === 0 ||
      activeSweepParameters.length > 0 ||
      missingParameterValues.length > 0
    ) {
      analysisRequestIdRef.current += 1;
      setAnalysisRunning(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void runModalAnalysis({ preserveScroll: true });
    }, MODAL_ANALYSIS_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeSweepParameters.length,
    missingParameterValues,
    output,
    outputParameters.length,
    parameterValues,
  ]);

  useEffect(() => {
    setSweepSliderValues((current) => {
      const next = selectedValuesForSweep(
        activeSweepParameters,
        sweepValidation.parameterValues,
        current,
      );
      return numericRecordEquals(current, next) ? current : next;
    });
  }, [activeSweepParameters, sweepValidation.parameterValues]);

  useEffect(() => {
    if (
      !output ||
      activeSweepParameters.length === 0 ||
      sweepValidation.error ||
      sweepValidation.totalCombinations === 0 ||
      missingSweepFixedValues.length > 0
    ) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      return;
    }

    const selectedGridPoint = selectedSweepGridPoint(
      selectedSweepValues,
      activeSweepParameters,
    );
    if (!selectedGridPoint) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      return;
    }

    const analysisParameterValues = sweepAnalysisParameterValues(
      parameterValues,
      selectedGridPoint,
    );
    const missing = missingParameterNames(output.parameters, analysisParameterValues);
    if (missing.length > 0) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      return;
    }

    const sweepProject = projectRef.current;
    const cacheKey = sweepCacheKey(sweepProject, analysisParameterValues);
    const cachedSample = sweepSampleCacheRef.current.get(cacheKey);
    if (cachedSample) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      setSweepError(null);
      setSweepSamples((current) =>
        selectedSampleForSweepValues(current, selectedGridPoint)
          ? current
          : upsertSweepSample(current, cachedSample),
      );
      setEngineStatus("Loaded cached sweep point.");
      return;
    }

    const requestId = sweepRequestIdRef.current + 1;
    sweepRequestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      if (requestId !== sweepRequestIdRef.current) {
        return;
      }
      setSweepRunning(true);
      setSweepError(null);
      setEngineWarmup((current) => ({
        base: "ready",
        analysis: current.analysis === "ready" ? "ready" : "warming",
        error: null,
      }));
      setEngineStatus("Calculating selected sweep point...");
      clientRef.current!
        .analyze(sweepProject, analysisParameterValues)
        .then((analysis) => {
          if (requestId !== sweepRequestIdRef.current) {
            return;
          }
          if (!analysis.available || analysis.error) {
            throw new Error(
              analysis.error ?? "BBQ modal analysis failed at the selected sweep point.",
            );
          }
          const sample = {
            analysis,
            value: selectedGridPoint[activeSweepParameters[0]],
            values: selectedGridPoint,
          };
          rememberSweepSample(sweepSampleCacheRef.current, cacheKey, sample);
          setSweepSamples((current) => upsertSweepSample(current, sample));
          setEngineWarmup({ base: "ready", analysis: "ready", error: null });
          setEngineStatus("Calculated selected sweep point.");
        })
        .catch((error) => {
          if (requestId !== sweepRequestIdRef.current) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          setSweepError(message);
          setEngineWarmup((current) => ({
            ...current,
            analysis: current.analysis === "ready" ? "ready" : "error",
            error: message,
          }));
          setEngineStatus(message);
        })
        .finally(() => {
          if (requestId === sweepRequestIdRef.current) {
            setSweepRunning(false);
          }
        });
    }, SWEEP_ANALYSIS_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeSweepParameters,
    missingSweepFixedValues,
    output,
    parameterValues,
    selectedSweepValues,
    sweepValidation.error,
    sweepValidation.totalCombinations,
  ]);

  useEffect(() => {
    if (!canStartSweepPrecompute({
      activeParameterCount: activeSweepParameters.length,
      hasSelectedSample: Boolean(selectedSweepSample),
      hasValidationError: Boolean(sweepValidation.error),
      missingFixedValueCount: missingSweepFixedValues.length,
      outputAvailable: Boolean(output),
      precomputeRunning: sweepPrecomputeRunning,
      sliderInteracting: sweepInteractionActive,
      sweepError,
      sweepRunning,
      totalCombinations: sweepValidation.totalCombinations,
    })) {
      return;
    }
    if (!output) {
      return;
    }

    const queuedPoints = buildSweepPrecomputeQueueFromParameters(
      sweepValidation.parameterValues,
      selectedSweepValues,
      activeSweepParameters,
      sweepSamples.map((sample) => sample.values ?? {}),
      sweepValidation.precomputeLimit,
    );
    const nextPoint = queuedPoints[0];
    if (!nextPoint) {
      return;
    }

    const sweepProject = projectRef.current;
    const analysisParameterValues = sweepAnalysisParameterValues(
      parameterValues,
      nextPoint,
    );
    const missing = missingParameterNames(output.parameters, analysisParameterValues);
    if (missing.length > 0) {
      return;
    }

    const cacheKey = sweepCacheKey(sweepProject, analysisParameterValues);
    const cachedSample = sweepSampleCacheRef.current.get(cacheKey);
    if (cachedSample) {
      setSweepSamples((current) => upsertSweepSample(current, cachedSample));
      return;
    }

    const contextId = sweepPrecomputeContextRef.current;
    const jobId = sweepPrecomputeJobIdRef.current + 1;
    sweepPrecomputeJobIdRef.current = jobId;
    const cancelIdleWork = scheduleIdleWork(() => {
      if (
        contextId !== sweepPrecomputeContextRef.current ||
        jobId !== sweepPrecomputeJobIdRef.current
      ) {
        return;
      }
      setSweepPrecomputeRunning(true);
      clientRef.current!
        .analyze(sweepProject, analysisParameterValues)
        .then((analysis) => {
          if (
            contextId !== sweepPrecomputeContextRef.current ||
            jobId !== sweepPrecomputeJobIdRef.current
          ) {
            return;
          }
          if (!analysis.available || analysis.error) {
            throw new Error(
              analysis.error ?? "BBQ modal analysis failed while precomputing sweep points.",
            );
          }
          const sample = {
            analysis,
            value: nextPoint[activeSweepParameters[0]],
            values: nextPoint,
          };
          rememberSweepSample(sweepSampleCacheRef.current, cacheKey, sample);
          setSweepSamples((current) => upsertSweepSample(current, sample));
          setEngineWarmup({ base: "ready", analysis: "ready", error: null });
        })
        .catch((error) => {
          if (
            contextId !== sweepPrecomputeContextRef.current ||
            jobId !== sweepPrecomputeJobIdRef.current
          ) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          setSweepError(`Background sweep precompute stopped: ${message}`);
        })
        .finally(() => {
          if (
            contextId === sweepPrecomputeContextRef.current &&
            jobId === sweepPrecomputeJobIdRef.current
          ) {
            setSweepPrecomputeRunning(false);
          }
        });
    });

    return cancelIdleWork;
  }, [
    activeSweepParameters,
    missingSweepFixedValues,
    output,
    parameterValues,
    selectedSweepSample,
    selectedSweepValues,
    sweepError,
    sweepInteractionActive,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
    sweepValidation.error,
    sweepValidation.parameterValues,
    sweepValidation.precomputeLimit,
    sweepValidation.totalCombinations,
  ]);

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
    if (nextStep === "generate") {
      setOutputDrawerOpen(true);
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

  function clearSweepResults() {
    sweepRequestIdRef.current += 1;
    sweepPrecomputeContextRef.current += 1;
    sweepPrecomputeJobIdRef.current += 1;
    if (sweepInteractionIdleTimerRef.current !== null) {
      window.clearTimeout(sweepInteractionIdleTimerRef.current);
      sweepInteractionIdleTimerRef.current = null;
    }
    setSweepSamples([]);
    setSweepSliderValues({});
    setSweepInteractionActive(false);
    setSweepRunning(false);
    setSweepPrecomputeRunning(false);
    setSweepError(null);
  }

  function markSweepSliderInteraction() {
    sweepPrecomputeContextRef.current += 1;
    sweepPrecomputeJobIdRef.current += 1;
    setSweepPrecomputeRunning(false);
    setSweepInteractionActive(true);
    if (sweepInteractionIdleTimerRef.current !== null) {
      window.clearTimeout(sweepInteractionIdleTimerRef.current);
    }
    sweepInteractionIdleTimerRef.current = window.setTimeout(() => {
      sweepInteractionIdleTimerRef.current = null;
      setSweepInteractionActive(false);
    }, SWEEP_INTERACTION_IDLE_MS);
  }

  function preserveOutputPanelScroll() {
    const panel = outputPanelRef.current;
    if (!panel) {
      return;
    }
    outputScrollRestoreRef.current = {
      expiresAt: performance.now() + 2200,
      top: panel.scrollTop,
    };
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
    if (outputGenerationPromiseRef.current) {
      return outputGenerationPromiseRef.current;
    }

    setOutputDrawerOpen(true);
    setEngineStatus(
      engineWarmup.base === "ready"
        ? "Generating matrices..."
        : "Python engine is warming; generating when ready...",
    );
    setSnippetCopied(false);
    analysisRequestIdRef.current += 1;
    setAnalysisRunning(false);
    setModalAnalysis(null);
    clearSweepResults();

    const generationPromise = (async () => {
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
      } finally {
        outputGenerationPromiseRef.current = null;
      }
    })();
    outputGenerationPromiseRef.current = generationPromise;
    return generationPromise;
  }

  function updateParameterValue(name: string, value: string) {
    analysisRequestIdRef.current += 1;
    setAnalysisRunning(false);
    setParameterValues((current) => ({ ...current, [name]: value }));
    setModalAnalysis(null);
    clearSweepResults();
  }

  async function runModalAnalysis(
    options: { preserveScroll?: boolean } = {},
  ): Promise<ModalAnalysisResult | null> {
    setOutputDrawerOpen(true);
    if (options.preserveScroll) {
      preserveOutputPanelScroll();
    }
    const result = output ?? (await runGenerateOutput());
    if (!result) {
      return null;
    }
    const analysisProject = projectRef.current;
    const analysisParameterValues = { ...parameterValues };
    const missing = missingParameterNames(result.parameters, analysisParameterValues);
    if (missing.length > 0) {
      setEngineStatus(
        `Enter parameter values before analysis: ${missing.join(", ")}`,
      );
      return null;
    }

    clearSweepResults();
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
    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;
    setAnalysisRunning(true);
    try {
      const analysis = await clientRef.current!.analyze(
        analysisProject,
        analysisParameterValues,
      );
      if (requestId !== analysisRequestIdRef.current) {
        return null;
      }
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
      if (requestId !== analysisRequestIdRef.current) {
        return null;
      }
      setModalAnalysis(null);
      setEngineWarmup((current) => ({
        ...current,
        analysis: current.analysis === "ready" ? "ready" : "error",
        error: error instanceof Error ? error.message : String(error),
      }));
      setEngineStatus(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      if (requestId === analysisRequestIdRef.current) {
        setAnalysisRunning(false);
      }
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
    setOutputDrawerOpen(true);
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

  function updateSweepConfig(name: string, updates: Partial<ParameterSweepConfig>) {
    setSweepConfig((current) => ({
      ...current,
      [name]: {
        ...(current[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG),
        ...updates,
      },
    }));
    clearSweepResults();
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
    setOutputDrawerOpen(false);
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
    setOutputDrawerOpen(false);
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
    setOutputDrawerOpen(false);
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
            active={outputDrawerOpen}
            icon={<Menu size={17} />}
            iconOnly={false}
            label="Output"
            onClick={() => setOutputDrawerOpen((open) => !open)}
          />
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

        </aside>
      </section>
      {outputDrawerOpen ? (
        <aside
          aria-label="Output"
          className="output-drawer"
          data-testid="output-drawer"
        >
          <section
            className="panel output-panel"
            data-testid="output-panel"
            ref={outputPanelRef}
          >
            <div className="output-panel-heading">
              <h2>Output</h2>
              <div className="output-panel-actions">
                <button
                  aria-label="Close output"
                  className="output-drawer-close"
                  onClick={() => setOutputDrawerOpen(false)}
                  title="Close output"
                  type="button"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="output-section output-section-matrices">
              <div className="output-section-heading">
                <div>
                  <h3>Matrices for Python</h3>
                  <p>Matrices are prepared automatically; copy the Python snippet when needed.</p>
                </div>
                <div className="output-panel-actions">
                  <button
                    aria-label="Copy matrices"
                    className={[
                      "output-action-button",
                      "output-copy-button",
                      tutorialStep === "copy" ? "tutorial-highlight-control" : "",
                    ].join(" ")}
                    disabled={!hasProjectContent}
                    onClick={copySnippet}
                    title={
                      hasGeneratedSnippet
                        ? "Copy matrices"
                        : "Prepare matrices and copy when ready"
                    }
                    type="button"
                  >
                    {snippetCopied ? <Check size={14} /> : <Copy size={14} />}
                    Copy matrices
                    {snippetCopied ? (
                      <span className="output-action-confirmation">Copied</span>
                    ) : null}
                  </button>
                </div>
              </div>
              <JosephsonBranchSummary branches={output?.josephson_branches ?? []} />
            </div>
            <div className="output-section output-section-analysis">
              <div className="output-section-heading">
                <div>
                  <h3>Frequencies and phase ZPF</h3>
                  <p>Analysis runs automatically when parameter values are complete.</p>
                </div>
              </div>
              <div className="analysis-workspace" data-testid="analysis-workspace">
                <div className="analysis-controls">
                  <AnalysisParameterPanel
                    activeSweepParameters={activeSweepParameters}
                    analysisRunning={analysisRunning}
                    cachedSweepGridPointCount={cachedSweepGridPointCount}
                    disabled={!output}
                    fixedMissingParameters={missingSweepFixedValues}
                    missingParameters={missingParameterValues}
                    onAnalyze={runModalAnalysis}
                    onParameterChange={updateParameterValue}
                    onRangeChange={updateSweepConfig}
                    onSliderChange={(name, value) => {
                      markSweepSliderInteraction();
                      preserveOutputPanelScroll();
                      setSweepSliderValues((current) => ({ ...current, [name]: value }));
                    }}
                    onExportAnalysis={exportAnalysisCsv}
                    parameters={outputParameters}
                    precomputeRunning={sweepPrecomputeRunning}
                    running={sweepRunning}
                    samples={sweepSamples}
                    selectedValues={sweepSliderValues}
                    sweepError={sweepError}
                    validation={sweepValidation}
                    values={parameterValues}
                    sweepValues={sweepConfig}
                  />
                </div>
                <div className="analysis-results" data-testid="analysis-results">
                  <ModalAnalysisPlots
                    result={displayedAnalysis}
                    yReferenceResults={
                      sweepModeActive ? sweepSamples.map((sample) => sample.analysis) : []
                    }
                  />
                  <ModalAnalysisTable result={displayedAnalysis} />
                </div>
              </div>
            </div>
          </section>
        </aside>
      ) : null}
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
          Open Output to prepare matrices; Copy matrices exports the Python snippet.
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
          <li>Use Ctrl/Cmd+S to save, Ctrl/Cmd+O to load, and Ctrl/Cmd+Enter to refresh matrices.</li>
          <li>Output prepares C and L_inv automatically; Copy matrices copies the Python snippet.</li>
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
  onPointerDown: (event: PointerEvent<SVGElement>, edgeId: number) => void;
}) {
  const endpoints = edgeEndpoints(edge, nodes);
  if (!endpoints) {
    return null;
  }

  const { end, start } = endpoints;
  const componentKind = edgeComponentKind(edge);
  const valueLabels = edgeValueLabels(edge, start, end, componentKind);
  const interactionZone = edgeInteractionZone(start, end, componentKind, valueLabels);
  const geometry = edgeGeometry(start, end);

  return (
    <g>
      {interactionZone ? (
        <rect
          className="edge-component-hit-target"
          data-testid={`edge-component-hit-target-${edge.identifier}`}
          height={interactionZone.height}
          transform={`translate(${geometry.center.x} ${geometry.center.y}) rotate(${geometry.angle})`}
          width={interactionZone.width}
          x={interactionZone.x}
          y={interactionZone.y}
          onPointerDown={(event) => onPointerDown(event, edge.identifier)}
        />
      ) : null}
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

function JosephsonBranchSummary({
  branches,
}: {
  branches: OutputResult["josephson_branches"];
}) {
  if (branches.length === 0) {
    return null;
  }

  return (
    <p className="jj-branch-summary" data-testid="jj-branches">
      {branches.length} Josephson branch{branches.length === 1 ? "" : "es"} included
      in the copied Python snippet.
    </p>
  );
}

function AnalysisParameterPanel({
  activeSweepParameters,
  analysisRunning,
  cachedSweepGridPointCount,
  disabled,
  fixedMissingParameters,
  missingParameters,
  onAnalyze,
  onParameterChange,
  onRangeChange,
  onSliderChange,
  onExportAnalysis,
  parameters,
  precomputeRunning,
  running,
  samples,
  selectedValues,
  sweepError,
  validation,
  values,
  sweepValues,
}: {
  activeSweepParameters: string[];
  analysisRunning: boolean;
  cachedSweepGridPointCount: number;
  disabled: boolean;
  fixedMissingParameters: string[];
  missingParameters: string[];
  onAnalyze: () => void;
  onParameterChange: (name: string, value: string) => void;
  onRangeChange: (name: string, updates: Partial<ParameterSweepConfig>) => void;
  onSliderChange: (name: string, value: number) => void;
  onExportAnalysis: () => void;
  parameters: string[];
  precomputeRunning: boolean;
  running: boolean;
  samples: SweepSample[];
  selectedValues: Record<string, number>;
  sweepError: string | null;
  validation: MultiSweepValidation;
  values: Record<string, string>;
  sweepValues: ParameterSweepConfigs;
}) {
  const missingParameterSet = new Set(missingParameters);
  const actionDisabled = disabled || missingParameters.length > 0;
  const refreshDisabled = actionDisabled || analysisRunning;
  const missingMessage =
    missingParameters.length > 0
      ? `Enter values for: ${missingParameters.join(", ")}`
      : "";
  const fixedMissingMessage =
    fixedMissingParameters.length > 0
      ? `Enter fixed values for: ${fixedMissingParameters.join(", ")}`
      : "";
  const parameterWarningMessage =
    activeSweepParameters.length > 0 ? fixedMissingMessage : missingMessage;
  const sweepValidationMessage =
    disabled
      ? ""
      : parameters.length === 0
        ? "Prepare matrices with at least one parameter to sweep."
        : activeSweepParameters.length === 0
          ? "Select Sweep on any parameter to enable sliders."
          : fixedMissingMessage || validation.error || sweepError || "";
  return (
    <div className="parameter-panel analysis-parameter-panel" data-testid="analysis-parameter-panel">
      <div className="parameter-panel-heading">
        <h3>Parameter values</h3>
        <div className="parameter-panel-actions">
          <button
            disabled={refreshDisabled}
            onClick={onAnalyze}
            title={missingMessage}
            type="button"
          >
            <Repeat2 size={14} />
            {analysisRunning ? "Analyzing..." : "Refresh"}
          </button>
          <button
            disabled={actionDisabled || analysisRunning}
            onClick={onExportAnalysis}
            title={missingMessage}
            type="button"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>
      {disabled ? (
        <p data-testid="parameter-empty">Open Output to prepare matrices for analysis.</p>
      ) : parameters.length === 0 ? (
        <p data-testid="parameter-empty">No parameters.</p>
      ) : (
        <>
          {parameterWarningMessage ? (
            <p
              className="parameter-panel-warning"
              data-testid="parameter-required-message"
            >
              {parameterWarningMessage}
            </p>
          ) : null}
          <div className="parameter-grid parameter-mode-grid" data-testid="parameter-values">
            {parameters.map((name) => (
              <ParameterControlRow
                key={name}
                disabled={disabled}
                missing={missingParameterSet.has(name)}
                name={name}
                onParameterChange={onParameterChange}
                onRangeChange={onRangeChange}
                onSliderChange={onSliderChange}
                range={sweepValues[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG}
                selectedSweepValue={selectedValues[name]}
                sweepValues={validation.parameterValues[name] ?? []}
                value={values[name] ?? ""}
              />
            ))}
          </div>
        </>
      )}
      <div className="parameter-sweep" data-testid="parameter-sweep">
        <div className="parameter-panel-heading">
          <h3>Parameter sweep</h3>
        </div>
        {sweepValidationMessage ? (
          <p className="parameter-panel-warning" data-testid="sweep-validation-message">
            {sweepValidationMessage}
          </p>
        ) : running ? (
          <p className="sweep-summary" data-testid="sweep-running-message">
            Calculating selected sweep point...
          </p>
        ) : validation.totalCombinations > 0 ? (
          <p className="sweep-summary" data-testid="sweep-point-count">
            {validation.totalCombinations} slider combination
            {validation.totalCombinations === 1 ? "" : "s"} available.
            Background cache: up to {validation.precomputeLimit} nearby point
            {validation.precomputeLimit === 1 ? "" : "s"}.
          </p>
        ) : null}
        {samples.length > 0 ? (
          <p className="sweep-summary" data-testid="sweep-result-summary">
            Cached points: {cachedSweepGridPointCount} / {validation.totalCombinations}.
            {precomputeRunning ? " Precomputing..." : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ParameterControlRow({
  disabled,
  missing,
  name,
  onParameterChange,
  onRangeChange,
  onSliderChange,
  range,
  selectedSweepValue,
  sweepValues,
  value,
}: {
  disabled: boolean;
  missing: boolean;
  name: string;
  onParameterChange: (name: string, value: string) => void;
  onRangeChange: (name: string, updates: Partial<ParameterSweepConfig>) => void;
  onSliderChange: (name: string, value: number) => void;
  range: ParameterSweepConfig;
  selectedSweepValue: number | undefined;
  sweepValues: number[];
  value: string;
}) {
  const displayedSweepValue = selectedSweepValue ?? sweepValues[0];
  const [manualSweepValueText, setManualSweepValueText] = useState(() =>
    displayedSweepValue === undefined ? "" : formatModalNumber(displayedSweepValue),
  );
  const [manualSweepValueFocused, setManualSweepValueFocused] = useState(false);
  const selectedIndex =
    displayedSweepValue === undefined
      ? 0
      : nearestSweepValueIndex(sweepValues, displayedSweepValue);
  const previousFixedValue = value.trim();
  const sweepReferenceValue = previousFixedValue
    ? `Previous: ${previousFixedValue}`
    : "Controlled by sweep";
  const sweepScale = range.scale ?? "linear";
  const stepLabel = sweepScale === "log" ? "Points/decade" : "Step";
  const stepPlaceholder = sweepScale === "log" ? "points" : "step";

  useEffect(() => {
    if (!manualSweepValueFocused) {
      setManualSweepValueText(
        displayedSweepValue === undefined ? "" : formatModalNumber(displayedSweepValue),
      );
    }
  }, [displayedSweepValue, manualSweepValueFocused]);

  function commitManualSweepValue() {
    const parsedValue = Number(manualSweepValueText);
    if (!Number.isFinite(parsedValue)) {
      setManualSweepValueText(
        displayedSweepValue === undefined ? "" : formatModalNumber(displayedSweepValue),
      );
      return;
    }
    onSliderChange(name, parsedValue);
    setManualSweepValueText(formatModalNumber(parsedValue));
  }

  return (
    <div className="parameter-control-row">
      <div className="parameter-control-main">
        <label>
          <span>{name}</span>
          <input
            aria-invalid={!range.enabled && missing ? true : undefined}
            aria-label={`Value for ${name}`}
            className={range.enabled ? "parameter-sweep-reference-input" : undefined}
            disabled={disabled || range.enabled}
            inputMode="decimal"
            onChange={(event) => onParameterChange(name, event.target.value)}
            placeholder="required"
            required={!range.enabled}
            value={range.enabled ? sweepReferenceValue : value}
          />
        </label>
        <label className="parameter-sweep-toggle">
          <input
            aria-label={`Sweep ${name}`}
            checked={range.enabled}
            disabled={disabled}
            onChange={(event) =>
              onRangeChange(name, { enabled: event.target.checked })
            }
            type="checkbox"
          />
          <span>Sweep</span>
        </label>
      </div>
      {range.enabled ? (
        <>
          <div className="sweep-grid parameter-range-grid">
            <label>
              <span>Scale</span>
              <select
                aria-label={`Sweep scale for ${name}`}
                disabled={disabled}
                onChange={(event) =>
                  onRangeChange(name, {
                    scale: event.target.value as SweepScale,
                  })
                }
                value={sweepScale}
              >
                <option value="linear">Linear</option>
                <option value="log">Log</option>
              </select>
            </label>
            <label>
              <span>Min</span>
              <input
                aria-label={`Sweep min for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onRangeChange(name, { min: event.target.value })}
                placeholder="min"
                value={range.min}
              />
            </label>
            <label>
              <span>Max</span>
              <input
                aria-label={`Sweep max for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onRangeChange(name, { max: event.target.value })}
                placeholder="max"
                value={range.max}
              />
            </label>
            <label>
              <span>{stepLabel}</span>
              <input
                aria-label={`Sweep step for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onRangeChange(name, { step: event.target.value })}
                placeholder={stepPlaceholder}
                value={range.step}
              />
            </label>
          </div>
          {sweepValues.length > 0 ? (
            <div className="sweep-sample-slider">
              <label className="sweep-manual-value">
                <span>{name}</span>
                <input
                  aria-label={`Selected sweep value for ${name}`}
                  disabled={disabled}
                  inputMode="decimal"
                  onBlur={() => {
                    setManualSweepValueFocused(false);
                    commitManualSweepValue();
                  }}
                  onChange={(event) =>
                    setManualSweepValueText(event.target.value)
                  }
                  onFocus={() => setManualSweepValueFocused(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  value={manualSweepValueText}
                />
              </label>
              <input
                aria-label={`Sweep sample for ${name}`}
                data-testid={`sweep-sample-slider-${name}`}
                disabled={disabled}
                max={sweepValues.length - 1}
                min={0}
                onChange={(event) =>
                  onSliderChange(name, sweepValues[Number(event.target.value)])
                }
                step={1}
                type="range"
                value={selectedIndex}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ModalAnalysisTable({ result }: { result: ModalAnalysisResult | null }) {
  if (!result?.available) {
    return null;
  }

  const frequencies = result.frequencies_ghz ?? [];
  const branches = result.branches ?? [];
  const modeCount = Math.max(
    frequencies.length,
    ...branches.map((branch) => branch.phase_zpf.length),
  );
  const collapseByDefault = branches.length > 6 || frequencies.length > 16;
  const modeCountText = `${modeCount} mode${modeCount === 1 ? "" : "s"}`;
  const branchCountText =
    branches.length > 0
      ? `, ${branches.length} JJ column${branches.length === 1 ? "" : "s"}`
      : "";
  return (
    <details
      className="modal-analysis"
      data-testid="modal-analysis"
      open={!collapseByDefault}
    >
      <summary className="modal-analysis-summary">
        <span className="modal-analysis-summary-title">
          <h3>BBQ modal results</h3>
          {collapseByDefault ? (
            <span className="modal-analysis-summary-note">
              Large result; use Export CSV for the full table.
            </span>
          ) : null}
        </span>
        <span className="modal-analysis-summary-meta">
          {modeCountText}
          {branchCountText}
        </span>
      </summary>
      <div className="modal-analysis-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>frequency GHz</th>
              {branches.map((branch, branchIndex) => (
                <th key={branch.edge_id ?? branchIndex}>
                  edge {branch.edge_id ?? branchIndex} phase{" "}
                  {branch.phase_nodes[0] ?? "GND"} -{" "}
                  {branch.phase_nodes[1] ?? "GND"}
                  <span className="modal-analysis-branch-note">
                    Ej {formatModalNumber(branch.E_j_GHz)} GHz
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: modeCount }, (_, modeIndex) => (
              <tr key={modeIndex}>
                <th>mode {modeIndex}</th>
                <td>
                  {frequencies[modeIndex] === undefined
                    ? ""
                    : formatModalNumber(frequencies[modeIndex])}
                </td>
                {branches.map((branch, branchIndex) => {
                  const zpf = branch.phase_zpf[modeIndex];
                  return (
                    <td key={branch.edge_id ?? branchIndex}>
                      {zpf === undefined ? "" : formatModalNumber(zpf)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ModalAnalysisPlots({
  frequencyTestId = "frequency-mode-plot",
  frequencyTitle = "Mode frequencies",
  result,
  yReferenceResults = [],
  zpfTestId = "zpf-mode-plot",
  zpfTitle = "JJ phase ZPF",
}: {
  frequencyTestId?: string;
  frequencyTitle?: string;
  result: ModalAnalysisResult | null;
  yReferenceResults?: ModalAnalysisResult[];
  zpfTestId?: string;
  zpfTitle?: string;
}) {
  type AnalysisPlotTab = "frequency" | "zpf";
  const [activePlot, setActivePlot] = useState<AnalysisPlotTab>("frequency");
  const frequencySeries = result?.available ? buildCurrentFrequencySeries(result) : [];
  const zpfSeries = result?.available ? buildCurrentZpfSeries(result) : [];
  const hasFrequencyPlot = frequencySeries.some((entry) => entry.points.length > 0);
  const hasZpfPlot = zpfSeries.some((entry) => entry.points.length > 0);
  const referenceResults = yReferenceResults.filter((entry) => entry.available);

  useEffect(() => {
    if (activePlot === "zpf" && !hasZpfPlot && hasFrequencyPlot) {
      setActivePlot("frequency");
    }
    if (activePlot === "frequency" && !hasFrequencyPlot && hasZpfPlot) {
      setActivePlot("zpf");
    }
  }, [activePlot, hasFrequencyPlot, hasZpfPlot]);

  if (!result?.available) {
    return null;
  }

  if (!hasFrequencyPlot && !hasZpfPlot) {
    return null;
  }

  const showPlotTabs = hasFrequencyPlot && hasZpfPlot;
  const selectedPlot = activePlot === "zpf" && hasZpfPlot ? "zpf" : "frequency";

  return (
    <div className="analysis-plots" data-testid="modal-analysis-plots">
      {showPlotTabs ? (
        <div
          aria-label="Analysis plot"
          className="analysis-plot-tabs"
          data-testid="analysis-plot-tabs"
          role="tablist"
        >
          <button
            aria-controls={`${frequencyTestId}-panel`}
            aria-selected={selectedPlot === "frequency"}
            data-testid="analysis-plot-tab-frequency"
            onClick={() => setActivePlot("frequency")}
            role="tab"
            type="button"
          >
            Frequencies
          </button>
          <button
            aria-controls={`${zpfTestId}-panel`}
            aria-selected={selectedPlot === "zpf"}
            data-testid="analysis-plot-tab-zpf"
            onClick={() => setActivePlot("zpf")}
            role="tab"
            type="button"
          >
            Phase ZPF
          </button>
        </div>
      ) : null}
      {selectedPlot === "frequency" && hasFrequencyPlot ? (
        <div id={`${frequencyTestId}-panel`} role="tabpanel">
          <AnalysisLineChart
            referenceYBoundsForSeries={() =>
              referenceFrequencyYBounds(referenceResults)
            }
            series={frequencySeries}
            testId={frequencyTestId}
            title={frequencyTitle}
            xLabel="mode index"
            yLabel="frequency GHz"
          />
        </div>
      ) : null}
      {selectedPlot === "zpf" && hasZpfPlot ? (
        <div id={`${zpfTestId}-panel`} role="tabpanel">
          <AnalysisLineChart
            referenceYBoundsForSeries={(seriesKeys) =>
              referenceZpfYBounds(referenceResults, seriesKeys)
            }
            series={zpfSeries}
            testId={zpfTestId}
            title={zpfTitle}
            xLabel="mode index"
            yLabel="phase ZPF"
          />
        </div>
      ) : null}
    </div>
  );
}

function AnalysisLineChart({
  referenceYBoundsForSeries,
  series,
  testId,
  title,
  xLabel,
  yLabel,
}: {
  referenceYBoundsForSeries?: (seriesKeys: string[]) => ChartYBounds | null;
  series: ChartSeries[];
  testId: string;
  title: string;
  xLabel: string;
  yLabel: string;
}) {
  type ChartAxisMode = "auto" | "fixed" | "manual";
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [hoveredPoint, setHoveredPoint] = useState<{
    color: string;
    point: ChartPoint;
    seriesLabel: string;
  } | null>(null);
  const [manualYMaxText, setManualYMaxText] = useState("");
  const [manualYMinText, setManualYMinText] = useState("");
  const [panStart, setPanStart] = useState<{
    domain: ChartBounds;
    x: number;
    y: number;
  } | null>(null);
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string>("__first__");
  const [yAxisMode, setYAxisMode] = useState<ChartAxisMode>("fixed");
  const [zoomDomain, setZoomDomain] = useState<ChartBounds | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const populatedSeries = series.filter((entry) => entry.points.length > 0);
  if (populatedSeries.length === 0) {
    return null;
  }

  const useSeriesSelect = populatedSeries.length > 6;
  const activeSelectedSeriesKey =
    selectedSeriesKey === "all"
      ? "all"
      : populatedSeries.some((entry) => entry.key === selectedSeriesKey)
        ? selectedSeriesKey
        : populatedSeries[0].key;
  const visibleSeries = useSeriesSelect
    ? activeSelectedSeriesKey === "all"
      ? populatedSeries
      : populatedSeries.filter((entry) => entry.key === activeSelectedSeriesKey)
    : populatedSeries.filter((entry) => !hiddenKeys.has(entry.key));
  const plottedSeries = visibleSeries.length > 0 ? visibleSeries : populatedSeries;
  const visibleSeriesKeys = plottedSeries.map((entry) => entry.key);
  const referenceYBounds = referenceYBoundsForSeries?.(visibleSeriesKeys) ?? null;
  const hasReferenceY = Boolean(referenceYBounds);
  const effectiveYAxisMode =
    yAxisMode === "fixed" && !hasReferenceY ? "auto" : yAxisMode;
  const manualYBounds = parseManualChartYBounds(manualYMinText, manualYMaxText);
  const bounds = chartBounds(
    plottedSeries,
    [],
    effectiveYAxisMode === "manual" && manualYBounds.bounds
      ? manualYBounds.bounds
      : undefined,
    effectiveYAxisMode === "fixed" ? referenceYBounds : null,
  );
  const displayBounds = zoomDomain ?? bounds;
  const xTicks = chartTicks(displayBounds.minX, displayBounds.maxX);
  const yTicks = chartTicks(displayBounds.minY, displayBounds.maxY);
  const viewWidth = 760;
  const viewHeight = 370;
  const plot = {
    bottom: 320,
    left: 78,
    right: 736,
    top: 22,
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const xScale = (value: number) =>
    plot.left +
    ((value - displayBounds.minX) / (displayBounds.maxX - displayBounds.minX)) *
      plotWidth;
  const yScale = (value: number) =>
    plot.bottom -
    ((value - displayBounds.minY) / (displayBounds.maxY - displayBounds.minY)) *
      plotHeight;
  const clipPathId = `${testId}-clip`;
  const manualAxisMessage =
    effectiveYAxisMode === "manual" && manualYBounds.error
      ? manualYBounds.error
      : "";

  function toggleSeries(key: string) {
    setHiddenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectSeries(key: string) {
    setSelectedSeriesKey(key);
    setHoveredPoint(null);
    setZoomDomain(null);
  }

  function changeYAxisMode(mode: ChartAxisMode) {
    setYAxisMode(mode);
    setZoomDomain(null);
  }

  function updateManualYMin(value: string) {
    setManualYMinText(value);
    setZoomDomain(null);
  }

  function updateManualYMax(value: string) {
    setManualYMaxText(value);
    setZoomDomain(null);
  }

  function svgPositionFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * viewWidth,
      y: ((clientY - rect.top) / rect.height) * viewHeight,
    };
  }

  function chartDataPointFromSvgPosition(
    position: { x: number; y: number },
    domain: ChartBounds,
  ) {
    return {
      x:
        domain.minX +
        ((position.x - plot.left) / plotWidth) * (domain.maxX - domain.minX),
      y:
        domain.minY +
        ((plot.bottom - position.y) / plotHeight) * (domain.maxY - domain.minY),
    };
  }

  function zoomChart(factor: number, center?: { x: number; y: number }) {
    const currentDomain = zoomDomain ?? displayBounds;
    const centerPoint = center
      ? chartDataPointFromSvgPosition(center, currentDomain)
      : {
          x: (currentDomain.minX + currentDomain.maxX) / 2,
          y: (currentDomain.minY + currentDomain.maxY) / 2,
        };
    setZoomDomain(zoomChartBounds(currentDomain, centerPoint, factor));
  }

  return (
    <div className="analysis-chart" data-testid={testId}>
      <div className="analysis-chart-heading">
        <h3>{title}</h3>
        <div className="analysis-chart-toolbar">
          <div
            aria-label={`${title} y-axis scale`}
            className="analysis-chart-axis-mode"
            role="group"
          >
            <button
              aria-pressed={effectiveYAxisMode === "auto"}
              data-testid={`${testId}-axis-auto`}
              onClick={() => changeYAxisMode("auto")}
              type="button"
            >
              Auto
            </button>
            <button
              aria-pressed={effectiveYAxisMode === "fixed"}
              data-testid={`${testId}-axis-fixed`}
              disabled={!hasReferenceY}
              onClick={() => changeYAxisMode("fixed")}
              title={
                hasReferenceY
                  ? "Use cached sweep points for the y-axis"
                  : "Run a sweep to use cached points for the y-axis"
              }
              type="button"
            >
              Fixed
            </button>
            <button
              aria-pressed={effectiveYAxisMode === "manual"}
              data-testid={`${testId}-axis-manual`}
              onClick={() => changeYAxisMode("manual")}
              type="button"
            >
              Manual
            </button>
          </div>
          <div className="analysis-chart-nav">
            <button
              aria-label={`${title} zoom in`}
              data-testid={`${testId}-zoom-in`}
              onClick={() => zoomChart(0.72)}
              type="button"
            >
              <ZoomIn size={14} />
            </button>
            <button
              aria-label={`${title} zoom out`}
              data-testid={`${testId}-zoom-out`}
              onClick={() => zoomChart(1.32)}
              type="button"
            >
              <ZoomOut size={14} />
            </button>
            <button
              aria-label={`${title} reset view`}
              data-testid={`${testId}-reset-view`}
              disabled={!zoomDomain}
              onClick={() => setZoomDomain(null)}
              type="button"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      </div>
      {effectiveYAxisMode === "manual" ? (
        <div className="analysis-chart-manual-axis">
          <label>
            <span>Y min</span>
            <input
              aria-label={`${title} y min`}
              data-testid={`${testId}-y-min`}
              inputMode="decimal"
              onChange={(event) => updateManualYMin(event.target.value)}
              placeholder="auto"
              value={manualYMinText}
            />
          </label>
          <label>
            <span>Y max</span>
            <input
              aria-label={`${title} y max`}
              data-testid={`${testId}-y-max`}
              inputMode="decimal"
              onChange={(event) => updateManualYMax(event.target.value)}
              placeholder="auto"
              value={manualYMaxText}
            />
          </label>
          {manualAxisMessage ? (
            <span
              className="analysis-chart-axis-warning"
              data-testid={`${testId}-axis-message`}
            >
              {manualAxisMessage}
            </span>
          ) : null}
        </div>
      ) : null}
      <svg
        aria-label={title}
        className={panStart ? "analysis-chart-panning" : undefined}
        onPointerMove={(event) => {
          if (!panStart) {
            return;
          }
          const position = svgPositionFromClient(event.clientX, event.clientY);
          if (!position) {
            return;
          }
          const xRange = panStart.domain.maxX - panStart.domain.minX;
          const yRange = panStart.domain.maxY - panStart.domain.minY;
          const dx = ((position.x - panStart.x) / plotWidth) * xRange;
          const dy = ((position.y - panStart.y) / plotHeight) * yRange;
          setZoomDomain({
            maxX: panStart.domain.maxX - dx,
            maxY: panStart.domain.maxY + dy,
            minX: panStart.domain.minX - dx,
            minY: panStart.domain.minY + dy,
          });
        }}
        role="img"
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        onPointerLeave={() => {
          setHoveredPoint(null);
          setPanStart(null);
        }}
        onPointerUp={() => setPanStart(null)}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) {
            return;
          }
          event.preventDefault();
          const position = svgPositionFromClient(event.clientX, event.clientY);
          zoomChart(event.deltaY > 0 ? 1.18 : 0.86, position ?? undefined);
        }}
      >
        <defs>
          <clipPath id={clipPathId}>
            <rect
              x={plot.left}
              y={plot.top}
              width={plotWidth}
              height={plotHeight}
            />
          </clipPath>
        </defs>
        <rect
          className="analysis-chart-plot-bg"
          data-testid={`${testId}-plot-area`}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            const position = svgPositionFromClient(event.clientX, event.clientY);
            if (!position) {
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            setPanStart({
              domain: zoomDomain ?? displayBounds,
              x: position.x,
              y: position.y,
            });
          }}
          x={plot.left}
          y={plot.top}
          width={plotWidth}
          height={plotHeight}
        />
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={`y-${tick}`}>
              <line
                className="analysis-chart-grid"
                x1={plot.left}
                x2={plot.right}
                y1={y}
                y2={y}
              />
              <text
                className="analysis-chart-tick"
                textAnchor="end"
                x={plot.left - 8}
                y={y + 4}
              >
                {formatChartTick(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = xScale(tick);
          return (
            <g key={`x-${tick}`}>
              <line
                className="analysis-chart-grid"
                x1={x}
                x2={x}
                y1={plot.top}
                y2={plot.bottom}
              />
              <text
                className="analysis-chart-tick"
                textAnchor="middle"
                x={x}
                y={plot.bottom + 18}
              >
                {formatChartTick(tick)}
              </text>
            </g>
          );
        })}
        <line
          className="analysis-chart-axis"
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={plot.bottom}
        />
        <line
          className="analysis-chart-axis"
          x1={plot.left}
          x2={plot.right}
          y1={plot.bottom}
          y2={plot.bottom}
        />
        <text
          className="analysis-chart-axis-label"
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={viewHeight - 6}
        >
          {xLabel}
        </text>
        <text
          className="analysis-chart-axis-label"
          textAnchor="middle"
          transform={`translate(14 ${(plot.top + plot.bottom) / 2}) rotate(-90)`}
        >
          {yLabel}
        </text>
        <g clipPath={`url(#${clipPathId})`}>
        {visibleSeries.map((entry, seriesIndex) => {
          const color = chartColor(seriesIndex);
          const scaledPoints = entry.points.map((point) => ({
            point,
            x: xScale(point.x),
            y: yScale(point.y),
          }));
          return (
            <g key={entry.key}>
              {scaledPoints.length > 1 ? (
                <path
                  className="analysis-chart-line"
                  d={pointsToPath(scaledPoints)}
                  stroke={color}
                />
              ) : null}
              {scaledPoints.map(({ point, x, y }, pointIndex) => (
                <circle
                  key={`${entry.key}-${pointIndex}`}
                  className="analysis-chart-point"
                  cx={x}
                  cy={y}
                  fill={color}
                  onPointerEnter={() =>
                    setHoveredPoint({
                      color,
                      point,
                      seriesLabel: entry.label,
                    })
                  }
                  r="4"
                />
              ))}
            </g>
          );
        })}
        </g>
        {hoveredPoint ? (
          <g className="analysis-chart-tooltip" transform="translate(438 30)">
            <rect width="158" height="58" rx="6" />
            <circle cx="12" cy="16" fill={hoveredPoint.color} r="4" />
            <text x="22" y="20">
              {hoveredPoint.seriesLabel}
            </text>
            <text x="10" y="38">
              {xLabel}: {formatChartTick(hoveredPoint.point.x)}
            </text>
            <text x="10" y="52">
              {yLabel}: {formatModalNumber(hoveredPoint.point.y)}
            </text>
          </g>
        ) : null}
      </svg>
      {populatedSeries.length > 1 ? (
        useSeriesSelect ? (
          <label className="analysis-chart-series-select">
            <span>Trace</span>
            <select
              aria-label={`${title} trace`}
              data-testid={`${testId}-trace-select`}
              onChange={(event) => selectSeries(event.target.value)}
              value={activeSelectedSeriesKey}
            >
              <option value="all">All traces</option>
              {populatedSeries.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="analysis-chart-legend">
            {populatedSeries.map((entry, index) => {
              const hidden = hiddenKeys.has(entry.key);
              return (
                <button
                  key={entry.key}
                  aria-pressed={!hidden}
                  className={hidden ? "muted" : ""}
                  onClick={() => toggleSeries(entry.key)}
                  type="button"
                >
                  <span
                    className="analysis-chart-swatch"
                    style={{ backgroundColor: chartColor(index) }}
                  />
                  {entry.label}
                </button>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

function parseManualChartYBounds(
  minText: string,
  maxText: string,
): { bounds?: { maxY: number; minY: number }; error: string | null } {
  if (minText.trim() === "" || maxText.trim() === "") {
    return { error: "Enter both y-axis limits." };
  }
  const minY = Number(minText);
  const maxY = Number(maxText);
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { error: "Y-axis limits must be finite numbers." };
  }
  if (maxY <= minY) {
    return { error: "Y max must be greater than y min." };
  }
  return { bounds: { maxY, minY }, error: null };
}

function zoomChartBounds(
  bounds: ChartBounds,
  center: { x: number; y: number },
  factor: number,
): ChartBounds {
  const nextWidth = (bounds.maxX - bounds.minX) * factor;
  const nextHeight = (bounds.maxY - bounds.minY) * factor;
  const minX = center.x - (center.x - bounds.minX) * factor;
  const minY = center.y - (center.y - bounds.minY) * factor;
  return {
    maxX: minX + nextWidth,
    maxY: minY + nextHeight,
    minX,
    minY,
  };
}

function chartTicks(min: number, max: number, count = 5): number[] {
  if (count <= 1 || min === max) {
    return [min];
  }
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    Number((min + step * index).toPrecision(12)),
  );
}

function chartColor(index: number): string {
  const colors = [
    "#1167c9",
    "#14746f",
    "#b42318",
    "#9a6700",
    "#7c3aed",
    "#c2410c",
    "#0f766e",
    "#be185d",
  ];
  return colors[index % colors.length];
}

function pointsToPath(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function formatChartTick(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e6) {
    return String(value);
  }
  return formatModalNumber(value);
}

function missingParameterNames(
  parameters: string[],
  values: Record<string, string>,
): string[] {
  return parameters.filter((name) => (values[name] ?? "").trim() === "");
}

function buildMultiSweepValues(
  parameters: string[],
  configs: ParameterSweepConfigs,
  maxPoints: number,
): MultiSweepValidation {
  const activeParameters = parameters.filter((name) => configs[name]?.enabled);
  const parameterValues: Record<string, number[]> = {};
  let totalCombinations = activeParameters.length === 0 ? 0 : 1;

  for (const parameter of activeParameters) {
    const config = configs[parameter] ?? INITIAL_PARAMETER_SWEEP_CONFIG;
    const validation = buildSweepValues(
      config.min,
      config.max,
      config.step,
      maxPoints,
      config.scale ?? "linear",
    );
    if (validation.error) {
      return {
        error: `${parameter}: ${validation.error}`,
        parameterValues,
        precomputeLimit: 0,
        parameters: activeParameters,
        totalCombinations: 0,
      };
    }
    parameterValues[parameter] = validation.values;
    totalCombinations *= validation.values.length;
  }

  return {
    error: null,
    parameterValues,
    precomputeLimit: Math.min(maxPoints, totalCombinations),
    parameters: activeParameters,
    totalCombinations,
  };
}

function selectedSampleForSweepValues(
  samples: SweepSample[],
  selectedValues: Record<string, number>,
): SweepSample | null {
  if (samples.length === 0) {
    return null;
  }
  const selectedNames = Object.keys(selectedValues);
  if (selectedNames.length === 0) {
    return null;
  }
  return (
    samples.find((sample) =>
      selectedNames.every((name) => sample.values?.[name] === selectedValues[name]),
    ) ?? null
  );
}

function countSweepGridSamples(
  parameterValues: Record<string, number[]>,
  samples: SweepSample[],
  parameters: string[],
): number {
  if (samples.length === 0 || parameters.length === 0) {
    return 0;
  }
  return samples.filter((sample) =>
    parameters.every((parameter) =>
      (parameterValues[parameter] ?? []).includes(sample.values?.[parameter] ?? NaN),
    ),
  ).length;
}

function selectedValuesForSweep(
  parameters: string[],
  parameterValues: Record<string, number[]>,
  currentValues: Record<string, number>,
): Record<string, number> {
  const selected: Record<string, number> = {};
  for (const parameter of parameters) {
    const values = parameterValues[parameter] ?? [];
    if (values.length === 0) {
      continue;
    }
    const currentValue = currentValues[parameter];
    const lowerBound = Math.min(values[0], values[values.length - 1]);
    const upperBound = Math.max(values[0], values[values.length - 1]);
    selected[parameter] =
      currentValue !== undefined &&
      Number.isFinite(currentValue) &&
      currentValue >= lowerBound &&
      currentValue <= upperBound
        ? currentValue
        : values[0];
  }
  return selected;
}

function selectedSweepGridPoint(
  selectedValues: Record<string, number>,
  parameters: string[],
): Record<string, number> | null {
  if (
    parameters.length === 0 ||
    parameters.some(
      (parameter) =>
        selectedValues[parameter] === undefined ||
        !Number.isFinite(selectedValues[parameter]),
    )
  ) {
    return null;
  }
  return parameters.reduce<Record<string, number>>((point, parameter) => {
    point[parameter] = selectedValues[parameter] as number;
    return point;
  }, {});
}

function nearestSweepValueIndex(values: number[], selectedValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  let nearestIndex = 0;
  let nearestDistance = Math.abs(values[0] - selectedValue);
  for (let index = 1; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - selectedValue);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function sweepAnalysisParameterValues(
  fixedValues: Record<string, string>,
  selectedValues: Record<string, number>,
): Record<string, string> {
  return {
    ...fixedValues,
    ...Object.fromEntries(
      Object.entries(selectedValues).map(([name, value]) => [name, String(value)]),
    ),
  };
}

function numericRecordEquals(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

function sweepCacheKey(
  project: CircuitProject,
  parameterValues: Record<string, string>,
): string {
  const sortedValues = Object.entries(parameterValues).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify({
    parameterValues: sortedValues,
    project: serializeProjectForDirtyCheck(project),
  });
}

function rememberSweepSample(
  cache: Map<string, SweepSample>,
  key: string,
  sample: SweepSample,
) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, sample);
  while (cache.size > MAX_SWEEP_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}

function upsertSweepSample(samples: SweepSample[], sample: SweepSample): SweepSample[] {
  const sampleValues = sample.values ?? {};
  const next = samples.filter((existing) => {
    const existingValues = existing.values ?? {};
    const keys = new Set([
      ...Object.keys(existingValues),
      ...Object.keys(sampleValues),
    ]);
    return !Array.from(keys).every(
      (key) => existingValues[key] === sampleValues[key],
    );
  });
  return [...next, sample];
}

function scheduleIdleWork(callback: () => void): () => void {
  const windowWithIdle = window as Window & {
    cancelIdleCallback?: (handle: number) => void;
    requestIdleCallback?: (
      callback: () => void,
      options?: { timeout: number },
    ) => number;
  };
  if (typeof windowWithIdle.requestIdleCallback === "function") {
    const handle = windowWithIdle.requestIdleCallback(callback, {
      timeout: SWEEP_PRECOMPUTE_IDLE_TIMEOUT_MS,
    });
    return () => windowWithIdle.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, SWEEP_PRECOMPUTE_IDLE_TIMEOUT_MS);
  return () => window.clearTimeout(handle);
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
): EdgeValueLabel[] {
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

function edgeInteractionZone(
  start: Point,
  end: Point,
  componentKind: EdgeComponentKind,
  labels: EdgeValueLabel[],
): EdgeInteractionZone | null {
  if (componentKind === "none") {
    return null;
  }
  const geometry = edgeGeometry(start, end);
  if (geometry.length === 0) {
    return null;
  }

  let minX = -Math.min(64, Math.max(32, geometry.length / 2 - NODE_RADIUS));
  let maxX = Math.min(64, Math.max(32, geometry.length / 2 - NODE_RADIUS));
  let minY = -58;
  let maxY = 58;
  if (
    componentKind === "parallel-lc" ||
    componentKind === "parallel-cj" ||
    componentKind === "parallel-lj" ||
    componentKind === "parallel-lcj"
  ) {
    minY = -86;
    maxY = 92;
  }

  for (const label of labels) {
    const local = globalToLocalEdgePoint(geometry, label.point);
    const halfTextWidth = Math.max(22, label.text.length * 3.9);
    minX = Math.min(minX, local.x - halfTextWidth - 8);
    maxX = Math.max(maxX, local.x + halfTextWidth + 8);
    minY = Math.min(minY, local.y - 18);
    maxY = Math.max(maxY, local.y + 10);
  }

  minX = clamp(minX, -geometry.length / 2 - 22, geometry.length / 2 + 42);
  maxX = clamp(maxX, -geometry.length / 2 - 42, geometry.length / 2 + 96);

  return {
    height: Math.max(28, maxY - minY),
    width: Math.max(28, maxX - minX),
    x: minX,
    y: minY,
  };
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

function globalToLocalEdgePoint(
  geometry: ReturnType<typeof edgeGeometry>,
  point: Point,
): Point {
  const angle = (geometry.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - geometry.center.x;
  const dy = point.y - geometry.center.y;
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
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
    title: "Prepare matrices",
    body:
      "Output prepares C and L_inv with the same engine used by the desktop app.",
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
  if (step === "edge-values" || step === "ground-values" || step === "generate") {
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
