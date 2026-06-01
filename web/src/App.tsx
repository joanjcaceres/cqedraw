import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  renameNode,
  updateEdgeValues,
} from "./graph";
import {
  buildParameterInputSpecs,
  convertAnalysisParameterValues,
  invalidAnalysisParameterNames,
  type ParameterInputMode,
} from "./parameterUnits";
import {
  CircuitProject,
  ModalAnalysisResult,
  OutputResult,
  ToolMode,
} from "./types";
import {
  fitProjectView,
  rectFromPoints,
} from "./viewBox";
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
import { buildExampleProject } from "./exampleProject";
import {
  matrixNodeLabelMap,
} from "./edgeGeometry";
import { InspectorPanel } from "./InspectorPanel";
import {
  buildOutputDefaults,
  extractProjectParameterNames,
  serializeOutputDefaultsForDirtyCheck,
} from "./outputDefaults";
import { OutputDrawer, type OutputDrawerState } from "./OutputDrawer";
import { TutorialOverlay } from "./TutorialOverlay";
import { useAppShortcuts } from "./useAppShortcuts";
import {
  useCanvasInteractionHandlers,
  type GroundDragState,
  type MarqueeState,
  type NodeDragState,
  type PanState,
} from "./useCanvasInteractionHandlers";
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
  const [, setAnalysisRunning] = useState(false);
  const [outputDrawerOpen, setOutputDrawerOpen] = useState(false);
  const [outputGenerationError, setOutputGenerationError] = useState<string | null>(
    null,
  );
  const [outputGenerationPending, setOutputGenerationPending] = useState(false);
  const [engineStatus, setEngineStatus] = useState("Ready.");
  const { clientRef, engineWarmup, setEngineWarmup } = useEngineWarmup();
  const [snippetCopied, setSnippetCopied] = useState(false);
  const dirtyOutputDefaults = useMemo(
    () =>
      buildOutputDefaults(
        output?.parameters ?? [],
        parameterValues,
        parameterInputModes,
      ),
    [output, parameterInputModes, parameterValues],
  );
  const outputDefaultsSnapshot = useMemo(
    () => serializeOutputDefaultsForDirtyCheck(dirtyOutputDefaults),
    [dirtyOutputDefaults],
  );
  const projectDirtySnapshotExtras = useMemo(
    () => [outputDefaultsSnapshot],
    [outputDefaultsSnapshot],
  );
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
    dirtySnapshotExtras: projectDirtySnapshotExtras,
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
    modalAnalysis,
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
  const outputDefaultParameterNames = useMemo(
    () =>
      output?.parameters.length
        ? output.parameters
        : extractProjectParameterNames(project),
    [output, project],
  );
  const outputDefaults = useMemo(
    () =>
      buildOutputDefaults(
        outputDefaultParameterNames,
        parameterValues,
        parameterInputModes,
      ),
    [outputDefaultParameterNames, parameterInputModes, parameterValues],
  );
  const outputDrawerState = useMemo<OutputDrawerState>(() => {
    if (output) {
      return null;
    }
    if (!hasProjectContent) {
      return {
        kind: "empty",
        title: "No project content",
        message: "Add nodes or edges before preparing matrices.",
      };
    }
    if (outputGenerationError) {
      return {
        kind: "error",
        title: "Output generation failed",
        message: outputGenerationError,
      };
    }
    if (outputGenerationPending || outputDrawerOpen) {
      if (engineWarmup.base === "ready") {
        return {
          kind: "generating",
          title: "Generating matrices",
          message: "Preparing C and L_inv for the current circuit.",
        };
      }
      return {
        kind: "warming",
        title: "Starting Python engine",
        message: "Loading the Python backend and preparing matrices.",
      };
    }
    return null;
  }, [
    engineWarmup.base,
    hasProjectContent,
    output,
    outputDrawerOpen,
    outputGenerationError,
    outputGenerationPending,
  ]);
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
    outputDefaults,
    outputDefaultsSnapshot,
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
    setParameterInputModes,
    setParameterValues,
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
    setOutputGenerationError,
    setOutputGenerationPending,
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
  const invalidParameterValues = useMemo(
    () =>
      invalidAnalysisParameterNames(
        outputParameters,
        activeParameterInputValues,
        parameterInputModes,
        parameterInputSpecs,
      ),
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

  function clearNodeSelection() {
    setSelectedNodeIds([]);
    setSelectedNodeId(null);
  }

  function loadExampleProject() {
    const next = buildExampleProject();
    dismissTutorial();
    commitProjectChange(() => next);
    resetProjectInteractionState();
    setParameterValues({});
    setParameterInputModes({});
    setOutput(null);
    clearSweepResults();
    setOutputDrawerOpen(false);
    setMode("select");
    setViewBox(fitProjectView(next));
    setEngineStatus("Loaded example circuit.");
  }

  const {
    handleCanvasPointerCancel,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
    handleEdgePointerDown,
    handleGroundPointerDown,
    handleNodePointerDown,
  } = useCanvasInteractionHandlers({
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
    pastePreviewActive: Boolean(pastePreview),
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
  });

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
          onLoadExample={loadExampleProject}
          onOpenHelp={() => setHelpOpen(true)}
          onStartTutorial={requestTutorialStart}
          pastePreview={pastePreview}
          pastePreviewClipboard={activePasteClipboard}
          panActive={Boolean(panState)}
          pendingEdgeNodeId={pendingEdgeNodeId}
          project={project}
          selectedEdgeId={selectedEdgeId}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds}
          statusIsCopyConfirmation={statusIsCopyConfirmation}
          tutorialStep={tutorialStep}
          tutorialSurfaceHighlighted={
            tutorialStep === "first-node" || tutorialStep === "second-node"
          }
          emptyWelcomeVisible={tutorialStep === null}
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
            onNodeNameChange={(nodeId, name) =>
              commitProjectChange((current) => renameNode(current, nodeId, name))
            }
            selectedNode={selectedNode}
            selectedNodeIds={selectedNodeIds}
          />
        </aside>
      </section>
      {outputDrawerOpen ? (
        <OutputDrawer
          activeSweepParameters={activeSweepParameters}
          cachedSweepGridPointCount={cachedSweepGridPointCount}
          displayedAnalysis={displayedAnalysis}
          hasGeneratedSnippet={hasGeneratedSnippet}
          hasProjectContent={hasProjectContent}
          invalidParameterValues={invalidParameterValues}
          missingParameterValues={missingParameterValues}
          missingSweepFixedValues={missingSweepFixedValues}
          onClose={() => setOutputDrawerOpen(false)}
          onCopySnippet={copySnippet}
          onExportAnalysisCsv={exportAnalysisCsv}
          onParameterInputModeChange={updateParameterInputMode}
          onParameterValueChange={updateParameterValue}
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
          onTutorialPhaseZpfViewed={() => setTutorialStep("copy")}
          output={output}
          outputDrawerState={outputDrawerState}
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
