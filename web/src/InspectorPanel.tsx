import type { CircuitEdge, CircuitNode } from "./types";
import { josephsonPhaseLabel } from "./edgeGeometry";
import type { TutorialStep } from "./tutorialFlow";

type EdgeValueTextUpdates = {
  capacitanceText?: string | null;
  inductanceText?: string | null;
  josephsonInductanceText?: string | null;
  josephsonPhaseSign?: 1 | -1;
};

export function InspectorPanel({
  edgeCount,
  matrixNodeLabels,
  mergeTargetLabel,
  nodeCount,
  onCloseInlineValueEditor,
  onEdgeValueTextChange,
  onNodeNameChange,
  selectedEdge,
  selectedEdgeLabel,
  selectedNode,
  selectedNodeIds,
  tutorialStep,
}: {
  edgeCount: number;
  matrixNodeLabels: Map<number, string>;
  mergeTargetLabel: string;
  nodeCount: number;
  onCloseInlineValueEditor: () => void;
  onEdgeValueTextChange: (edgeId: number, values: EdgeValueTextUpdates) => void;
  onNodeNameChange: (nodeId: number, name: string) => void;
  selectedEdge: CircuitEdge | null;
  selectedEdgeLabel: string | null;
  selectedNode: CircuitNode | null;
  selectedNodeIds: number[];
  tutorialStep: TutorialStep | null;
}) {
  return (
    <section className="panel">
      <h2>Inspector</h2>
      {selectedEdge ? (
        <div className="form-grid">
          <label>
            <span>Edge</span>
            <input
              value={selectedEdgeLabel ?? ""}
              readOnly
              onFocus={onCloseInlineValueEditor}
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
              onFocus={onCloseInlineValueEditor}
              onChange={(event) => {
                onEdgeValueTextChange(selectedEdge.identifier, {
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
              onFocus={onCloseInlineValueEditor}
              onChange={(event) => {
                onEdgeValueTextChange(selectedEdge.identifier, {
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
              onFocus={onCloseInlineValueEditor}
              onChange={(event) => {
                onEdgeValueTextChange(selectedEdge.identifier, {
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
                  onEdgeValueTextChange(selectedEdge.identifier, {
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
                onNodeNameChange(selectedNode.identifier, event.target.value)
              }
            />
          </label>
        </div>
      ) : selectedNodeIds.length > 1 ? (
        <div className="metrics">
          <span data-testid="merge-target-summary">Merge keeps {mergeTargetLabel}</span>
        </div>
      ) : (
        <div className="metrics">
          <span>{nodeCount} nodes</span>
          <span>{edgeCount} edges</span>
        </div>
      )}
    </section>
  );
}
