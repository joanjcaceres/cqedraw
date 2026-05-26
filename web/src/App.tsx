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
} from "./graph";
import {
  buildSweepPrecomputeQueueFromParameters,
  canStartSweepPrecompute,
  MAX_SWEEP_POINTS,
  type SweepSample,
} from "./analysis";
import {
  buildParameterInputSpecs,
  convertAnalysisParameterValues,
  convertParameterDisplayValue,
  type ParameterInputMode,
} from "./parameterUnits";
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
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_VIEW_BOX,
  GRID_TILE_SIZE,
  NODE_RADIUS,
  WHEEL_DELTA_LIMIT,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  clamp,
  clampNodeDragDeltaToView,
  fitProjectView,
  gridRectForView,
  moveDraggedNodes,
  nodeIdsInsideRect,
  normalizeWheelDelta,
  rectFromPoints,
  svgPoint,
  svgPointFromClient,
  viewBoxToString,
  zoomViewBox,
  type NodeDragPosition,
  type Point,
  type ViewBox,
} from "./viewBox";
import {
  PROJECT_HISTORY_LIMIT,
  appendProjectHistoryEntry,
  clipboardFromSelection,
  deletionStatusMessage,
  pasteSelectionClipboard,
  projectsMatch,
  selectionStatusMessage,
  serializeProjectForDirtyCheck,
  shouldIgnoreAppShortcut,
  type ProjectHistory,
  type SelectionClipboard,
} from "./projectState";
import {
  INITIAL_PARAMETER_SWEEP_CONFIG,
  buildMultiSweepValues,
  countSweepGridSamples,
  missingParameterNames,
  nearestSweepValueIndex,
  numericRecordEquals,
  rememberSweepSample,
  scheduleIdleWork,
  selectedSampleForSweepValues,
  selectedSweepGridPoint,
  selectedValuesForSweep,
  sweepAnalysisParameterValues,
  sweepCacheKey,
  upsertSweepSample,
  type ParameterSweepConfig,
  type ParameterSweepConfigs,
} from "./sweepState";
import { downloadCsv } from "./csvExport";
import {
  AnalysisParameterPanel,
  JosephsonBranchSummary,
  ModalAnalysisTable,
} from "./AnalysisParameterPanel";
import {
  ConcatenateDialog,
  HelpDialog,
  NewProjectDialog,
  TutorialResetDialog,
} from "./AppDialogs";
import { ModalAnalysisPlots } from "./ModalAnalysisPlots";
import {
  CircuitEdgeShape,
  inlineEdgeEditorPosition,
  type InlineEdgeEditorPosition,
  josephsonPhaseLabel,
  matrixNodeLabelMap,
} from "./CircuitEdgeShape";
import {
  TUTORIAL_STEPS,
  isTutorialDismissed,
  nextTutorialStep,
  rememberTutorialDismissed,
  tutorialPlacement,
  type TutorialPlacement,
  type TutorialStep,
} from "./tutorialFlow";

const COPY_MATRICES_STATUS =
  "Copied matrices to clipboard. Paste them into Python or a notebook.";
const MODAL_ANALYSIS_DEBOUNCE_MS = 250;
const OUTPUT_GENERATION_DEBOUNCE_MS = 250;
const SWEEP_ANALYSIS_DEBOUNCE_MS = 120;
const SWEEP_INTERACTION_IDLE_MS = 350;

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

interface PastePreviewState {
  anchor: Point;
}

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
  const [parameterInputModes, setParameterInputModes] = useState<
    Record<string, ParameterInputMode>
  >({});
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
  const parameterInputSpecs = useMemo(
    () => buildParameterInputSpecs(output, project.state.edges),
    [output, project.state.edges],
  );

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
        parameterInputModes,
        parameterInputSpecs,
      ),
    [outputParameters, parameterInputModes, parameterInputSpecs, sweepConfig],
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
  const activeParameterInputValues = useMemo(() => {
    const selectedGridPoint = selectedSweepGridPoint(
      selectedSweepValues,
      activeSweepParameters,
    );
    return activeSweepParameters.length > 0 && selectedGridPoint
      ? sweepAnalysisParameterValues(parameterValues, selectedGridPoint)
      : parameterValues;
  }, [activeSweepParameters, parameterValues, selectedSweepValues]);
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
    setSweepConfig((current) => {
      const next: ParameterSweepConfigs = {};
      for (const name of outputParameters) {
        next[name] = current[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG;
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

  useEffect(() => {
    if (
      !output ||
      outputParameters.length === 0 ||
      activeSweepParameters.length > 0 ||
      missingParameterValues.length > 0 ||
      parameterInputError
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
    parameterInputError,
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
    const convertedParameterValues = convertAnalysisParameterValues(
      output.parameters,
      analysisParameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (convertedParameterValues.error) {
      sweepRequestIdRef.current += 1;
      setSweepRunning(false);
      setSweepError(convertedParameterValues.error);
      return;
    }

    const sweepProject = projectRef.current;
    const cacheKey = sweepCacheKey(sweepProject, convertedParameterValues.values);
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
        .analyze(sweepProject, convertedParameterValues.values)
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
    parameterInputModes,
    parameterInputSpecs,
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
    const convertedParameterValues = convertAnalysisParameterValues(
      output.parameters,
      analysisParameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (convertedParameterValues.error) {
      return;
    }

    const cacheKey = sweepCacheKey(sweepProject, convertedParameterValues.values);
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
        .analyze(sweepProject, convertedParameterValues.values)
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
    parameterInputModes,
    parameterInputSpecs,
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

  function updateParameterInputMode(name: string, mode: ParameterInputMode) {
    const spec = parameterInputSpecs[name];
    const nextMode = spec?.kind ? mode : "physical";
    const previousMode = parameterInputModes[name] ?? "physical";
    if (previousMode === nextMode) {
      return;
    }

    analysisRequestIdRef.current += 1;
    setAnalysisRunning(false);
    setParameterInputModes((current) => ({ ...current, [name]: nextMode }));
    setParameterValues((current) => ({
      ...current,
      [name]: convertParameterDisplayValue(
        current[name] ?? "",
        spec,
        previousMode,
        nextMode,
      ),
    }));
    setSweepConfig((current) => ({
      ...current,
      [name]: INITIAL_PARAMETER_SWEEP_CONFIG,
    }));
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
    const convertedParameterValues = convertAnalysisParameterValues(
      result.parameters,
      analysisParameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (convertedParameterValues.error) {
      setEngineStatus(convertedParameterValues.error);
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
        convertedParameterValues.values,
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
    const exportParameterValues = convertAnalysisParameterValues(
      result.parameters,
      parameterValues,
      parameterInputModes,
      parameterInputSpecs,
    );
    if (exportParameterValues.error) {
      setEngineStatus(exportParameterValues.error);
      return;
    }

    setEngineStatus("Exporting analysis table CSV...");
    try {
      const exportResult = await clientRef.current!.exportAnalysisJson(
        project,
        exportParameterValues.values,
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
                    inputError={parameterInputError}
                    inputModes={parameterInputModes}
                    missingParameters={missingParameterValues}
                    onAnalyze={runModalAnalysis}
                    onInputModeChange={updateParameterInputMode}
                    onParameterChange={updateParameterValue}
                    onRangeChange={updateSweepConfig}
                    onSliderChange={(name, value) => {
                      markSweepSliderInteraction();
                      preserveOutputPanelScroll();
                      setSweepSliderValues((current) =>
                        current[name] === value ? current : { ...current, [name]: value },
                      );
                    }}
                    onSliderInteraction={() => {
                      markSweepSliderInteraction();
                      preserveOutputPanelScroll();
                    }}
                    parameters={outputParameters}
                    parameterSpecs={parameterInputSpecs}
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
                    placeholderAvailable={Boolean(output && outputParameters.length > 0)}
                    placeholderZpfAvailable={
                      Boolean(output?.josephson_branches?.length)
                    }
                    result={displayedAnalysis}
                    yReferenceResults={
                      sweepModeActive ? sweepSamples.map((sample) => sample.analysis) : []
                    }
                  />
                  <ModalAnalysisTable
                    result={displayedAnalysis}
                    onExportAnalysis={exportAnalysisCsv}
                  />
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
