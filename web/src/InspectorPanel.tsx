import type { CircuitNode } from "./types";

export function InspectorPanel({
  edgeCount,
  matrixNodeLabels,
  mergeTargetLabel,
  nodeCount,
  onNodeNameChange,
  selectedNode,
  selectedNodeIds,
}: {
  edgeCount: number;
  matrixNodeLabels: Map<number, string>;
  mergeTargetLabel: string;
  nodeCount: number;
  onNodeNameChange: (nodeId: number, name: string) => void;
  selectedNode: CircuitNode | null;
  selectedNodeIds: number[];
}) {
  return (
    <section className="panel">
      <h2>Inspector</h2>
      {selectedNode ? (
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
