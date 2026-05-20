import {
  ClipboardCopy,
  ClipboardPaste,
  Circle,
  CircleHelp,
  Copy,
  Download,
  GitBranch,
  Home,
  Maximize2,
  Merge,
  MousePointer2,
  Play,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
  WheelEvent,
} from "react";

import {
  addEdge,
  addNode,
  emptyProject,
  mergeNodes,
  normalizeProject,
  removeEdge,
  removeNode,
  renameNode,
  toggleGround,
  updateEdgeValues,
} from "./graph";
import { PyodideBridgeClient } from "./pyodideClient";
import {
  CircuitEdge,
  CircuitNode,
  CircuitProject,
  GROUND_NODE_ID,
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
  startPoint: Point;
  nodePositions: NodeDragPosition[];
}

interface NodeDragPosition {
  identifier: number;
  x: number;
  y: number;
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

export function App() {
  const [project, setProject] = useState<CircuitProject>(() => emptyProject());
  const [cleanProjectSnapshot, setCleanProjectSnapshot] = useState(() =>
    serializeProjectForDirtyCheck(emptyProject()),
  );
  const [mode, setMode] = useState<ToolMode>("node");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [pendingEdgeNodeId, setPendingEdgeNodeId] = useState<number | null>(null);
  const [nodeDragState, setNodeDragState] = useState<NodeDragState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [selectionClipboard, setSelectionClipboard] =
    useState<SelectionClipboard | null>(null);
  const [pastePreview, setPastePreview] = useState<PastePreviewState | null>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEW_BOX);
  const [output, setOutput] = useState<OutputResult | null>(null);
  const [engineStatus, setEngineStatus] = useState("Ready.");
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialPromptOpen, setTutorialPromptOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null);
  const [tutorialResetOpen, setTutorialResetOpen] = useState(false);
  const [tutorialCopied, setTutorialCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const clientRef = useRef<PyodideBridgeClient | null>(null);
  const gridRect = gridRectForView(viewBox);

  useEffect(() => {
    clientRef.current = new PyodideBridgeClient();
    return () => clientRef.current?.dispose();
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
  const currentProjectSnapshot = useMemo(
    () => serializeProjectForDirtyCheck(project),
    [project],
  );
  const hasUnsavedChanges = currentProjectSnapshot !== cleanProjectSnapshot;

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
    if (project.state.nodes.length > 0 && tutorialPromptOpen && tutorialStep === null) {
      dismissTutorial();
    }
  }, [project.state.nodes.length, tutorialPromptOpen, tutorialStep]);

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
    setPanState(null);
    setMarqueeState(null);
  }

  function selectSingleNode(nodeId: number) {
    setSelectedNodeIds([nodeId]);
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function clearNodeSelection() {
    setSelectedNodeIds([]);
    setSelectedNodeId(null);
  }

  function toggleNodeSelection(nodeId: number) {
    setSelectedEdgeId(null);
    setSelectedNodeIds((current) => {
      if (current.includes(nodeId)) {
        const next = current.filter((id) => id !== nodeId);
        setSelectedNodeId((focused) =>
          focused === nodeId ? next[next.length - 1] ?? null : focused,
        );
        return next;
      }
      setSelectedNodeId(nodeId);
      return [...current, nodeId];
    });
  }

  function handleCanvasPointerDown(event: PointerEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    if (pastePreview) {
      completePastePreview(point);
      return;
    }

    if (mode === "node") {
      setProject((current) => {
        const next = addNode(current, point.x, point.y);
        const id = next.state.node_counter - 1;
        setSelectedNodeIds([id]);
        setSelectedNodeId(id);
        setSelectedEdgeId(null);
        return next;
      });
      setOutput(null);
      return;
    }
    if (mode === "select") {
      event.currentTarget.setPointerCapture(event.pointerId);
      if (event.shiftKey) {
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
    setPendingEdgeNodeId(null);
  }

  function handleNodePointerDown(
    event: PointerEvent<SVGCircleElement>,
    nodeId: number,
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarqueeState(null);

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
        setProject((current) => {
          const before = current.state.edge_counter;
          const next = addEdge(current, pendingEdgeNodeId, nodeId);
          if (next.state.edge_counter > before) {
            setSelectedEdgeId(before);
            clearNodeSelection();
          } else {
            setSelectedEdgeId(null);
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
      setProject((current) => {
        const existing = current.state.edges.find(
          (edge) => edge.is_ground && edge.nodes[0] === nodeId,
        );
        const next = toggleGround(current, nodeId);
        if (existing) {
          setSelectedNodeIds([nodeId]);
          setSelectedNodeId(nodeId);
        } else {
          clearNodeSelection();
        }
        setSelectedEdgeId(existing ? null : current.state.edge_counter);
        return next;
      });
      setOutput(null);
      return;
    }

    if (mode === "select" && event.shiftKey) {
      toggleNodeSelection(nodeId);
      setNodeDragState(null);
      setPanState(null);
      return;
    }

    const isDraggingExistingSelection =
      mode === "select" &&
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
      startPoint: svgPointFromClient(svg, event.clientX, event.clientY),
      nodePositions,
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
      mode === "select"
    ) {
      const current = svgPoint(event);
      setMarqueeState((state) =>
        state?.pointerId === event.pointerId ? { ...state, current } : state,
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
      setProject((current) =>
        moveDraggedNodes(current, nodeDragState.nodePositions, delta.x, delta.y),
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
      mode === "select"
    ) {
      const selectionRect = rectFromPoints(marqueeState.start, svgPoint(event));
      const selectedIds = nodeIdsInsideRect(project.state.nodes, selectionRect);
      setSelectedNodeIds(selectedIds);
      setSelectedNodeId(selectedIds[selectedIds.length - 1] ?? null);
      setSelectedEdgeId(null);
      setPendingEdgeNodeId(null);
      setMarqueeState(null);
      setPanState(null);
      setNodeDragState(null);
      setEngineStatus(
        selectedIds.length === 0
          ? "Selection cleared."
          : `Selected ${selectedIds.length} node${selectedIds.length === 1 ? "" : "s"}.`,
      );
      return;
    }

    setNodeDragState(null);
    setPanState(null);
  }

  function handleCanvasPointerCancel() {
    setNodeDragState(null);
    setPanState(null);
    setMarqueeState(null);
    cancelPastePreview();
  }

  function handleCanvasWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const anchor = svgPoint(event);
    const normalizedDelta = normalizeWheelDelta(event);
    const limitedDelta = clamp(
      normalizedDelta,
      -WHEEL_DELTA_LIMIT,
      WHEEL_DELTA_LIMIT,
    );
    const factor = Math.exp(limitedDelta * WHEEL_ZOOM_SENSITIVITY);
    setPanState(null);
    setMarqueeState(null);
    setViewBox((current) => zoomViewBox(current, factor, anchor));
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

    setSelectedEdgeId(edgeId);
    clearNodeSelection();
    setPendingEdgeNodeId(null);
    setPanState(null);
    setMarqueeState(null);
    setPastePreview(null);
  }

  function deleteSelection() {
    if (selectedEdgeId !== null) {
      setProject((current) => removeEdge(current, selectedEdgeId));
      setSelectedEdgeId(null);
      setOutput(null);
      return;
    }
    if (selectedNodeId !== null) {
      setProject((current) => removeNode(current, selectedNodeId));
      setSelectedNodeIds([]);
      setSelectedNodeId(null);
      setOutput(null);
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

    setProject(result.project);
    setSelectedNodeIds([selectedNodeId]);
    setSelectedNodeId(selectedNodeId);
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
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
    setPastePreview(null);
    setEngineStatus(`Copied ${clipboard.nodes.length} node(s) to clipboard.`);
  }

  function startPastePreview() {
    if (!selectionClipboard) {
      setEngineStatus("Clipboard is empty.");
      return;
    }

    setMode("select");
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
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

    const result = pasteSelectionClipboard(project, selectionClipboard, anchor);
    setProject(result.project);
    setSelectedNodeIds(result.nodeIds);
    setSelectedNodeId(result.nodeIds[result.nodeIds.length - 1] ?? null);
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
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
    setEngineStatus("Loading Python engine and generating...");
    try {
      const result = await clientRef.current!.generate(project);
      if (result.error) {
        throw new Error(result.error);
      }
      setOutput(result);
      setEngineStatus(`Generated ${result.size} x ${result.size} matrices.`);
      return result;
    } catch (error) {
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
    setEngineStatus("Snippet copied.");
    setTutorialCopied(true);
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
    setProject(next);
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

  function closeHelp() {
    setHelpOpen(false);
    window.requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  function beginTutorial() {
    const next = emptyProject();
    setProject(next);
    setCleanProjectSnapshot(serializeProjectForDirtyCheck(next));
    setMode("node");
    clearNodeSelection();
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setNodeDragState(null);
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
    if (!pastePreview) {
      return;
    }

    function handlePastePreviewKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPastePreview();
      }
    }

    window.addEventListener("keydown", handlePastePreviewKeyDown);
    return () => window.removeEventListener("keydown", handlePastePreviewKeyDown);
  }, [pastePreview]);

  const selectedEdgeLabel = selectedEdge
    ? selectedEdge.is_ground
      ? `Ground ${selectedEdge.nodes[0]}`
      : `${selectedEdge.nodes[0]}-${selectedEdge.nodes[1]}`
    : null;
  const marqueeRect = marqueeState
    ? rectFromPoints(marqueeState.start, marqueeState.current)
    : null;
  const activePasteClipboard = pastePreview ? selectionClipboard : null;

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
            onClick={() => setModeAndReset("select")}
          />
          <ToolButton
            active={mode === "node"}
            highlight={tutorialStep === "first-node" || tutorialStep === "second-node"}
            icon={<Circle size={17} />}
            label="Node"
            onClick={() => setModeAndReset("node")}
          />
          <ToolButton
            active={mode === "edge"}
            highlight={tutorialStep === "edge-mode"}
            icon={<GitBranch size={17} />}
            label="Edge"
            onClick={() => setModeAndReset("edge")}
          />
          <ToolButton
            active={mode === "ground"}
            highlight={tutorialStep === "ground-mode"}
            icon={<Home size={17} />}
            label="Ground"
            onClick={() => setModeAndReset("ground")}
          />
          <ToolButton
            disabled={selectedNodeIds.length < 2}
            icon={<Merge size={17} />}
            label="Merge"
            onClick={mergeSelectedNodes}
          />
          <ToolButton
            icon={<ClipboardCopy size={17} />}
            label="Copy Selection"
            onClick={copySelectedGraphElements}
          />
          <ToolButton
            icon={<ClipboardPaste size={17} />}
            label="Paste"
            onClick={startPastePreview}
          />
          <ToolButton
            icon={<Trash2 size={17} />}
            label="Delete"
            onClick={deleteSelection}
          />
        </div>
        <div className="toolbar actions" aria-label="Project actions">
          <ToolButton
            highlight={tutorialStep === "generate"}
            icon={<Play size={17} />}
            label="Generate"
            onClick={generateOutput}
          />
          <ToolButton
            highlight={tutorialStep === "copy"}
            icon={<Copy size={17} />}
            label="Copy"
            onClick={copySnippet}
          />
          <ToolButton icon={<Download size={17} />} label="Save" onClick={saveProject} />
          <span aria-live="polite" data-testid="save-status">
            {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
          </span>
          <ToolButton
            icon={<Upload size={17} />}
            label="Load"
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
          <div className="canvas-controls" aria-label="Canvas view controls">
            <IconButton
              icon={<ZoomIn size={17} />}
              label="Zoom in"
              onClick={() => zoomCanvas(ZOOM_IN_FACTOR)}
            />
            <IconButton
              icon={<ZoomOut size={17} />}
              label="Zoom out"
              onClick={() => zoomCanvas(ZOOM_OUT_FACTOR)}
            />
            <IconButton
              icon={<Maximize2 size={17} />}
              label="Fit view"
              onClick={fitCanvasView}
            />
          </div>
          <svg
            className={[
              "circuit-canvas",
              mode === "select" ? "pan-ready" : "",
              panState ? "panning" : "",
              marqueeState ? "selecting" : "",
              tutorialStep === "first-node" || tutorialStep === "second-node"
                ? "tutorial-highlight-surface"
                : "",
            ].join(" ")}
            data-testid="canvas"
            viewBox={viewBoxToString(viewBox)}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerCancel}
            onPointerLeave={handleCanvasPointerCancel}
            onWheel={handleCanvasWheel}
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
              />
            ))}
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
                <text className="node-label" x={node.x + 16} y={node.y + 5}>
                  {node.name}
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
          <div className="status-line" data-testid="output-status">
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
                  <input value={selectedEdgeLabel ?? ""} readOnly />
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
                    onChange={(event) => {
                      setProject((current) =>
                        updateEdgeValues(current, selectedEdge.identifier, {
                          capacitanceText: event.target.value,
                        }),
                      );
                      setOutput(null);
                    }}
                  />
                </label>
                <label>
                  <span>Inductance</span>
                  <input
                    className={
                      tutorialStep === "edge-values"
                        ? "tutorial-highlight-control"
                        : undefined
                    }
                    data-testid="ind-input"
                    value={selectedEdge.inductance_text ?? ""}
                    onChange={(event) => {
                      setProject((current) =>
                        updateEdgeValues(current, selectedEdge.identifier, {
                          inductanceText: event.target.value,
                        }),
                      );
                      setOutput(null);
                    }}
                  />
                </label>
              </div>
            ) : selectedNode ? (
              <div className="form-grid">
                <label>
                  <span>Node</span>
                  <input
                    value={selectedNode.name}
                    onChange={(event) =>
                      setProject((current) =>
                        renameNode(current, selectedNode.identifier, event.target.value),
                      )
                    }
                  />
                </label>
              </div>
            ) : selectedNodeIds.length > 1 ? (
              <div className="metrics">
                <span>{selectedNodeIds.length} nodes selected</span>
                <span>Merge will keep node {selectedNodeId}</span>
              </div>
            ) : (
              <div className="metrics">
                <span>{project.state.nodes.length} nodes</span>
                <span>{project.state.edges.length} edges</span>
              </div>
            )}
          </section>

          <section className="panel output-panel">
            <h2>Output</h2>
            <EntryList title="C entries" testId="c-entries" entries={output?.c_entries ?? []} />
            <EntryList
              title="L_inv entries"
              testId="l-entries"
              entries={output?.l_inv_entries ?? []}
            />
            <textarea
              data-testid="snippet-output"
              value={output?.snippet ?? ""}
              readOnly
              spellCheck={false}
            />
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
          then select an edge to enter C/L.
        </tspan>
        <tspan x={CANVAS_WIDTH / 2} dy="28">
          Generate and Copy create the Python matrix snippet.
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
          <li>Use Ground, then click a node to add or remove its ground reference.</li>
          <li>Select an edge and enter capacitance and inductance in the Inspector.</li>
          <li>Inputs accept SymPy-style values such as Cj, 40e-15, and 1/Lj_inv.</li>
          <li>Use the canvas buttons, wheel, or trackpad to zoom; use Select and drag empty canvas to pan, or Shift-drag to box-select nodes.</li>
          <li>Use Copy Selection and Paste to duplicate selected nodes and their contained connections.</li>
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

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="icon-button"
      title={label}
      type="button"
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function ToolButton({
  active = false,
  buttonRef,
  disabled = false,
  highlight = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  highlight?: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        "tool-button",
        active ? "active" : "",
        highlight ? "tutorial-highlight" : "",
      ].join(" ")}
      disabled={disabled}
      ref={buttonRef}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CircuitEdgeShape({
  edge,
  nodes,
  selected,
  onPointerDown,
}: {
  edge: CircuitEdge;
  nodes: CircuitNode[];
  selected: boolean;
  onPointerDown: (event: PointerEvent<SVGLineElement>, edgeId: number) => void;
}) {
  const first = nodes.find((node) => node.identifier === edge.nodes[0]);
  const second =
    edge.nodes[1] === GROUND_NODE_ID
      ? null
      : nodes.find((node) => node.identifier === edge.nodes[1]);
  if (!first || (!second && !edge.is_ground)) {
    return null;
  }

  const endX = edge.is_ground ? first.x + edge.ground_offset_x : second!.x;
  const endY = edge.is_ground ? first.y + edge.ground_offset_y : second!.y;
  const labelX = (first.x + endX) / 2;
  const labelY = (first.y + endY) / 2 - 8;
  const label = edgeLabel(edge);

  return (
    <g>
      <line
        data-testid={`edge-${edge.identifier}`}
        className={selected ? "edge-line selected" : "edge-line"}
        x1={first.x}
        y1={first.y}
        x2={endX}
        y2={endY}
        onPointerDown={(event) => onPointerDown(event, edge.identifier)}
      />
      {edge.is_ground ? <GroundSymbol x={endX} y={endY} /> : null}
      <text className="edge-label" x={labelX} y={labelY}>
        {label}
      </text>
    </g>
  );
}

function GroundSymbol({ x, y }: { x: number; y: number }) {
  return (
    <g className="ground-symbol">
      <line x1={x - 18} y1={y} x2={x + 18} y2={y} />
      <line x1={x - 12} y1={y + 10} x2={x + 12} y2={y + 10} />
      <line x1={x - 6} y1={y + 20} x2={x + 6} y2={y + 20} />
    </g>
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

function edgeLabel(edge: CircuitEdge): string {
  const parts = [];
  if (edge.capacitance_text) {
    parts.push(`C=${edge.capacitance_text}`);
  }
  if (edge.inductance_text) {
    parts.push(`L=${edge.inductance_text}`);
  }
  return parts.join(", ") || "edge";
}

function svgPoint(event: PointerEvent<SVGSVGElement> | WheelEvent<SVGSVGElement>) {
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

function normalizeWheelDelta(event: WheelEvent<SVGSVGElement>): number {
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
    body: "With the edge selected, enter C for Capacitance and L for Inductance.",
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
    body: "For this tutorial, enter Cg for Capacitance and leave Inductance empty.",
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
    title: "Copy the snippet",
    body: "Click Copy to place the generated Python matrix snippet on the clipboard.",
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
