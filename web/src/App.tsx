import {
  Circle,
  Copy,
  Download,
  GitBranch,
  Home,
  MousePointer2,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import { PointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  addEdge,
  addNode,
  emptyProject,
  moveNode,
  normalizeProject,
  removeEdge,
  removeNode,
  renameNode,
  sampleProject,
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

export function App() {
  const [project, setProject] = useState<CircuitProject>(() => emptyProject());
  const [mode, setMode] = useState<ToolMode>("node");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);
  const [pendingEdgeNodeId, setPendingEdgeNodeId] = useState<number | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<number | null>(null);
  const [output, setOutput] = useState<OutputResult | null>(null);
  const [engineStatus, setEngineStatus] = useState("Ready.");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const clientRef = useRef<PyodideBridgeClient | null>(null);

  useEffect(() => {
    clientRef.current = new PyodideBridgeClient();
    return () => clientRef.current?.dispose();
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    }
  }, []);

  const selectedNode = useMemo(
    () => project.state.nodes.find((node) => node.identifier === selectedNodeId) ?? null,
    [project, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => project.state.edges.find((edge) => edge.identifier === selectedEdgeId) ?? null,
    [project, selectedEdgeId],
  );

  function setModeAndReset(nextMode: ToolMode) {
    setMode(nextMode);
    setPendingEdgeNodeId(null);
    setDraggingNodeId(null);
  }

  function handleCanvasPointerDown(event: PointerEvent<SVGSVGElement>) {
    const point = svgPoint(event);
    if (mode === "node") {
      setProject((current) => {
        const next = addNode(current, point.x, point.y);
        const id = next.state.node_counter - 1;
        setSelectedNodeId(id);
        setSelectedEdgeId(null);
        return next;
      });
      setOutput(null);
      return;
    }
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
  }

  function handleNodePointerDown(
    event: PointerEvent<SVGCircleElement>,
    nodeId: number,
  ) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (mode === "edge") {
      if (pendingEdgeNodeId === null) {
        setPendingEdgeNodeId(nodeId);
      } else {
        setProject((current) => {
          const before = current.state.edge_counter;
          const next = addEdge(current, pendingEdgeNodeId, nodeId);
          if (next.state.edge_counter > before) {
            setSelectedEdgeId(before);
            setSelectedNodeId(null);
          } else {
            setSelectedEdgeId(null);
            setSelectedNodeId(nodeId);
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
        setSelectedNodeId(existing ? nodeId : null);
        setSelectedEdgeId(existing ? null : current.state.edge_counter);
        return next;
      });
      setOutput(null);
      return;
    }

    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDraggingNodeId(nodeId);
  }

  function handleCanvasPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (draggingNodeId === null || mode === "edge" || mode === "ground") {
      return;
    }
    const point = svgPoint(event);
    setProject((current) => moveNode(current, draggingNodeId, point.x, point.y));
  }

  function handleCanvasPointerUp() {
    setDraggingNodeId(null);
  }

  function handleEdgePointerDown(event: PointerEvent<SVGLineElement>, edgeId: number) {
    event.stopPropagation();
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setPendingEdgeNodeId(null);
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
      setSelectedNodeId(null);
      setOutput(null);
    }
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
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadProject(file: File) {
    const parsed = JSON.parse(await file.text());
    const next = normalizeProject(parsed);
    setProject(next);
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
    setPendingEdgeNodeId(null);
    setOutput(null);
  }

  function loadSample() {
    setProject(sampleProject());
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingEdgeNodeId(null);
    setOutput(null);
  }

  const selectedEdgeLabel = selectedEdge
    ? selectedEdge.is_ground
      ? `Ground ${selectedEdge.nodes[0]}`
      : `${selectedEdge.nodes[0]}-${selectedEdge.nodes[1]}`
    : null;

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
            icon={<Circle size={17} />}
            label="Node"
            onClick={() => setModeAndReset("node")}
          />
          <ToolButton
            active={mode === "edge"}
            icon={<GitBranch size={17} />}
            label="Edge"
            onClick={() => setModeAndReset("edge")}
          />
          <ToolButton
            active={mode === "ground"}
            icon={<Home size={17} />}
            label="Ground"
            onClick={() => setModeAndReset("ground")}
          />
        </div>
        <div className="toolbar actions" aria-label="Project actions">
          <ToolButton icon={<Play size={17} />} label="Generate" onClick={generateOutput} />
          <ToolButton icon={<Copy size={17} />} label="Copy" onClick={copySnippet} />
          <ToolButton icon={<Download size={17} />} label="Save" onClick={saveProject} />
          <ToolButton
            icon={<Upload size={17} />}
            label="Load"
            onClick={() => fileInputRef.current?.click()}
          />
          <ToolButton label="Sample" onClick={loadSample} />
          <ToolButton
            icon={<Trash2 size={17} />}
            label="Delete"
            onClick={deleteSelection}
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
          <svg
            className="circuit-canvas"
            data-testid="canvas"
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
          >
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#dce5ee" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#grid)" />
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
                    selectedNodeId === node.identifier ? "selected" : "",
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
    </main>
  );
}

function ToolButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "tool-button active" : "tool-button"}
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

function svgPoint(event: PointerEvent<SVGSVGElement>) {
  const svg = event.currentTarget;
  const matrix = svg.getScreenCTM();
  if (!matrix) {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}
