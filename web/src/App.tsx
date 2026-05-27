import {
  PointerEvent,
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
  DEFAULT_VIEW_BOX,
  WHEEL_DELTA_LIMIT,
  WHEEL_ZOOM_SENSITIVITY,
  clamp,
  clampNodeDragDeltaToView,
  fitProjectView,
  moveDraggedNodes,
  nodeIdsInsideRect,
  normalizeWheelDelta,
  rectFromPoints,
  svgPoint,
  svgPointFromClient,
  zoomViewBox,
  type NodeDragPosition,
  type Point,
  type ViewBox,
} from "./viewBox";
import {
  clipboardFromSelection,
  deletionStatusMessage,
  pasteSelectionClipboard,
  projectsMatch,
  selectionStatusMessage,
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
  ConcatenateDialog,
  HelpDialog,
  NewProjectDialog,
  TutorialResetDialog,
} from "./AppDialogs";
import { AppToolbar } from "./AppToolbar";
import { CircuitCanvas } from "./CircuitCanvas";
import {
  inlineEdgeEditorPosition,
  type InlineEdgeEditorPosition,
  matrixNodeLabelMap,
} from "./CircuitEdgeShape";
import { InspectorPanel } from "./InspectorPanel";
import { OutputDrawer } from "./OutputDrawer";
import { TutorialOverlay } from "./TutorialOverlay";
import {
  isTutorialDismissed,
  nextTutorialStep,
  rememberTutorialDismissed,
  type TutorialStep,
} from "./tutorialFlow";
import { useAppShortcuts } from "./useAppShortcuts";
import { useEngineWarmup } from "./useEngineWarmup";
import { useOutputPanelScroll } from "./useOutputPanelScroll";
import { useProjectHistory } from "./useProjectHistory";

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
  const { clientRef, engineWarmup, setEngineWarmup } = useEngineWarmup();
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
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const inlineValueEditorRef = useRef<HTMLDivElement | null>(null);
  const inlineCapInputRef = useRef<HTMLInputElement | null>(null);
  const newProjectButtonRef = useRef<HTMLButtonElement | null>(null);
  const nodeButtonRef = useRef<HTMLButtonElement | null>(null);
  const concatenateButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const analysisRequestIdRef = useRef(0);
  const outputGenerationPromiseRef = useRef<Promise<OutputResult | null> | null>(
    null,
  );
  const sweepSampleCacheRef = useRef<Map<string, SweepSample>>(new Map());
  const sweepPrecomputeContextRef = useRef(0);
  const sweepPrecomputeJobIdRef = useRef(0);
  const sweepInteractionIdleTimerRef = useRef<number | null>(null);
  const sweepRequestIdRef = useRef(0);

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
  const { outputPanelRef, preserveOutputPanelScroll } = useOutputPanelScroll([
    displayedAnalysis,
    engineStatus,
    sweepPrecomputeRunning,
    sweepRunning,
    sweepSamples,
  ]);

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
    markProjectClean();
    setEngineStatus("Project saved.");
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadProject(file: File) {
    const parsed = JSON.parse(await file.text());
    const next = normalizeProject(parsed);
    setProjectState(next);
    resetProjectHistory();
    markProjectClean(next);
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
    resetProjectHistory();
    markProjectClean(next);
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
    resetProjectHistory();
    markProjectClean(next);
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
            setSweepSliderValues((current) =>
              current[name] === value ? current : { ...current, [name]: value },
            );
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
