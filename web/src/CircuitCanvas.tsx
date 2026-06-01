import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  Ref,
} from "react";

import { type ConcatenatePreviewBridge } from "./graph";
import { type SelectionClipboard } from "./projectState";
import {
  type CircuitEdge,
  type CircuitProject,
  type ToolMode,
} from "./types";
import {
  GRID_TILE_SIZE,
  NODE_RADIUS,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  gridRectForView,
  viewBoxToString,
  type Point,
  type ViewBox,
} from "./viewBox";
import {
  CircuitEdgeShape,
} from "./CircuitEdgeShape";
import {
  josephsonPhaseLabel,
  type InlineEdgeEditorPosition,
} from "./edgeGeometry";
import type { TutorialStep } from "./tutorialFlow";

export function CircuitCanvas({
  canvasRef,
  canvasStageRef,
  concatenatePreviewBridges,
  engineStatus,
  fitCanvasView,
  handleCanvasPointerCancel,
  handleCanvasPointerDown,
  handleCanvasPointerMove,
  handleCanvasPointerUp,
  handleEdgePointerDown,
  handleGroundPointerDown,
  handleNodePointerDown,
  inlineCapInputRef,
  inlineValueEditorEdge,
  inlineValueEditorPosition,
  inlineValueEditorRef,
  marqueeActive,
  marqueeRect,
  matrixNodeLabels,
  mode,
  onCloseInlineValueEditor,
  onLoadExample,
  onOpenHelp,
  onStartTutorial,
  pastePreview,
  pastePreviewClipboard,
  panActive,
  pendingEdgeNodeId,
  project,
  selectedEdgeId,
  selectedNodeId,
  selectedNodeIds,
  statusIsCopyConfirmation,
  emptyWelcomeVisible,
  tutorialStep,
  tutorialSurfaceHighlighted,
  updateEdgeValueText,
  viewBox,
  zoomCanvas,
}: {
  canvasRef: Ref<SVGSVGElement>;
  canvasStageRef: Ref<HTMLDivElement>;
  concatenatePreviewBridges: ConcatenatePreviewBridge[];
  engineStatus: string;
  fitCanvasView: () => void;
  handleCanvasPointerCancel: (event: PointerEvent<SVGSVGElement>) => void;
  handleCanvasPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  handleCanvasPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  handleCanvasPointerUp: (event: PointerEvent<SVGSVGElement>) => void;
  handleEdgePointerDown: (event: PointerEvent<SVGElement>, edgeId: number) => void;
  handleGroundPointerDown: (
    event: PointerEvent<SVGGElement>,
    edgeId: number,
  ) => void;
  handleNodePointerDown: (
    event: PointerEvent<SVGCircleElement>,
    nodeId: number,
  ) => void;
  inlineCapInputRef: Ref<HTMLInputElement>;
  inlineValueEditorEdge: CircuitEdge | null;
  inlineValueEditorPosition: InlineEdgeEditorPosition | null;
  inlineValueEditorRef: Ref<HTMLDivElement>;
  marqueeActive: boolean;
  marqueeRect: ViewBox | null;
  matrixNodeLabels: Map<number, string>;
  mode: ToolMode;
  onCloseInlineValueEditor: () => void;
  onLoadExample: () => void;
  onOpenHelp: () => void;
  onStartTutorial: () => void;
  pastePreview: { anchor: Point } | null;
  pastePreviewClipboard: SelectionClipboard | null;
  panActive: boolean;
  pendingEdgeNodeId: number | null;
  project: CircuitProject;
  selectedEdgeId: number | null;
  selectedNodeId: number | null;
  selectedNodeIds: number[];
  statusIsCopyConfirmation: boolean;
  emptyWelcomeVisible: boolean;
  tutorialStep: TutorialStep | null;
  tutorialSurfaceHighlighted: boolean;
  updateEdgeValueText: (
    edgeId: number,
    values: {
      capacitanceText?: string | null;
      inductanceText?: string | null;
      josephsonInductanceText?: string | null;
      josephsonPhaseSign?: 1 | -1;
    },
  ) => void;
  viewBox: ViewBox;
  zoomCanvas: (factor: number) => void;
}) {
  const gridRect = gridRectForView(viewBox);
  const tutorialTargetNodeIds = tutorialNodeTargetIds(
    project,
    pendingEdgeNodeId,
    tutorialStep,
  );
  const tutorialTargetEdgeIds = tutorialEdgeTargetIds(project, tutorialStep);

  return (
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
            panActive ? "panning" : "",
            marqueeActive ? "selecting" : "",
            tutorialSurfaceHighlighted ? "tutorial-highlight-surface" : "",
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
          {project.state.edges.map((edge) => (
            <CircuitEdgeShape
              key={edge.identifier}
              edge={edge}
              nodes={project.state.nodes}
              selected={selectedEdgeId === edge.identifier}
              tutorialTarget={tutorialTargetEdgeIds.has(edge.identifier)}
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
                  tutorialTargetNodeIds.has(node.identifier)
                    ? "tutorial-target"
                    : "",
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
          {pastePreview && pastePreviewClipboard ? (
            <PastePreview
              anchor={pastePreview.anchor}
              clipboard={pastePreviewClipboard}
            />
          ) : null}
        </svg>
        {project.state.nodes.length === 0 && emptyWelcomeVisible ? (
          <EmptyCanvasWelcome
            onLoadExample={onLoadExample}
            onOpenHelp={onOpenHelp}
            onStartTutorial={onStartTutorial}
          />
        ) : null}
        {inlineValueEditorEdge && inlineValueEditorPosition ? (
          <InlineEdgeValueEditor
            capInputRef={inlineCapInputRef}
            edge={inlineValueEditorEdge}
            editorRef={inlineValueEditorRef}
            matrixNodeLabels={matrixNodeLabels}
            position={inlineValueEditorPosition}
            tutorialStep={tutorialStep}
            onClose={onCloseInlineValueEditor}
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
  );
}

function tutorialNodeTargetIds(
  project: CircuitProject,
  pendingEdgeNodeId: number | null,
  tutorialStep: TutorialStep | null,
): Set<number> {
  const [firstNode, secondNode] = project.state.nodes;
  if (!firstNode || !secondNode) {
    return new Set();
  }

  if (tutorialStep === "connect-edge") {
    if (pendingEdgeNodeId === null) {
      return new Set([firstNode.identifier]);
    }

    return new Set(
      project.state.nodes
        .filter((node) => node.identifier !== pendingEdgeNodeId)
        .map((node) => node.identifier),
    );
  }

  if (tutorialStep === "add-ground") {
    return new Set([secondNode.identifier]);
  }

  return new Set();
}

function tutorialEdgeTargetIds(
  project: CircuitProject,
  tutorialStep: TutorialStep | null,
): Set<number> {
  if (tutorialStep !== "edit-edge") {
    return new Set();
  }

  const regularEdge = project.state.edges.find((edge) => !edge.is_ground);
  return regularEdge ? new Set([regularEdge.identifier]) : new Set();
}

function EmptyCanvasWelcome({
  onLoadExample,
  onOpenHelp,
  onStartTutorial,
}: {
  onLoadExample: () => void;
  onOpenHelp: () => void;
  onStartTutorial: () => void;
}) {
  return (
    <section
      aria-label="First-run guide"
      className="canvas-empty-state"
      data-testid="canvas-hint"
    >
      <span className="canvas-empty-eyebrow">Superconducting circuit graph editor</span>
      <h2>Build circuit graphs into matrices</h2>
      <p>
        Draw nodes, edges, and ground references. cQEDraw prepares sparse C and
        L_inv matrices, then runs supported modal analysis in the browser.
      </p>
      <ol className="canvas-empty-flow" aria-label="cQEDraw workflow">
        <li>
          <strong>Draw</strong>
          <span>Place a circuit graph on the canvas.</span>
        </li>
        <li>
          <strong>Generate</strong>
          <span>Prepare Python-ready C and L_inv snippets.</span>
        </li>
        <li>
          <strong>Analyze</strong>
          <span>Explore supported modes and parameter sweeps.</span>
        </li>
      </ol>
      <div className="canvas-empty-actions">
        <button type="button" onClick={onStartTutorial}>
          Start tutorial
        </button>
        <button type="button" onClick={onLoadExample}>
          Load example circuit
        </button>
        <button
          className="canvas-empty-secondary"
          type="button"
          onClick={onOpenHelp}
        >
          Cite and support
        </button>
      </div>
    </section>
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
  matrixNodeLabels,
  tutorialStep,
}: {
  capInputRef: Ref<HTMLInputElement>;
  edge: CircuitEdge;
  editorRef: Ref<HTMLDivElement>;
  matrixNodeLabels: Map<number, string>;
  position: InlineEdgeEditorPosition;
  tutorialStep: TutorialStep | null;
  onClose: () => void;
  onValueChange: (
    edgeId: number,
    values: {
      capacitanceText?: string | null;
      inductanceText?: string | null;
      josephsonInductanceText?: string | null;
      josephsonPhaseSign?: 1 | -1;
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
          className={
            tutorialStep === "edge-values" || tutorialStep === "ground-values"
              ? "tutorial-highlight-control"
              : undefined
          }
          data-testid="cap-input"
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
          className={
            tutorialStep === "edge-values" ? "tutorial-highlight-control" : undefined
          }
          data-testid="ind-input"
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
          className={
            tutorialStep === "ground-values"
              ? "tutorial-highlight-control"
              : undefined
          }
          data-testid="jj-ind-input"
          value={edge.josephson_inductance_text ?? ""}
          onChange={(event) =>
            onValueChange(edge.identifier, {
              josephsonInductanceText: event.target.value,
            })
          }
        />
      </label>
      {edge.josephson_inductance_text?.trim() ? (
        <div className="phase-control" data-testid="jj-phase-control">
          <span data-testid="jj-phase-label">
            {josephsonPhaseLabel(edge, matrixNodeLabels)}
          </span>
          <button
            type="button"
            onClick={() =>
              onValueChange(edge.identifier, {
                josephsonPhaseSign: edge.josephson_phase_sign === -1 ? 1 : -1,
              })
            }
          >
            Reverse
          </button>
        </div>
      ) : null}
    </div>
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
