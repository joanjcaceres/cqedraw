import { GripHorizontal } from "lucide-react";
import {
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type ConcatenatePortPair,
  type ConcatenateSelectionAnalysis,
} from "./graph";
import {
  APP_VERSION,
  CITATION_URL,
  CONTACT_EMAIL,
  ISSUES_URL,
  REPOSITORY_URL,
  SITE_URL,
} from "./appMetadata";
import { clamp } from "./viewBox";

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

export function ConcatenateDialog({
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

export function NewProjectDialog({
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

export function TutorialResetDialog({
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

export function HelpDialog({
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
        <div className="help-dialog-body">
          <section aria-labelledby="help-overview-title" className="help-section">
            <h3 id="help-overview-title">What cQEDraw produces</h3>
            <p>
              Draw a superconducting circuit graph, then use Output to generate
              sparse SciPy C and L_inv matrices and run supported modal analysis
              in the browser.
            </p>
          </section>
          <section aria-labelledby="help-cite-title" className="help-section">
            <h3 id="help-cite-title">Cite and support</h3>
            <p>
              Citation: Joan Caceres, cQEDraw: Superconducting Circuit Graph
              Editor, v{APP_VERSION}, {SITE_URL}
            </p>
            <ul>
              <li>
                <a href={CITATION_URL} target="_blank" rel="noreferrer">
                  Citation file
                </a>
              </li>
              <li>
                <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
                  cQEDraw repository
                </a>
              </li>
              <li>
                <a href={ISSUES_URL} target="_blank" rel="noreferrer">
                  Report an issue
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT_EMAIL}`}>Contact Joan</a>
              </li>
            </ul>
          </section>
          <section aria-labelledby="help-workflow-title" className="help-section">
            <h3 id="help-workflow-title">Workflow</h3>
            <ol>
              <li>Use Node and click the canvas to place circuit nodes.</li>
              <li>Use Edge, then click two nodes to connect them.</li>
              <li>Use Ground, then click a node to add its ground reference; select and delete a ground connection to remove it.</li>
              <li>Select an edge and enter capacitance, linear inductance, and Josephson inductance in the value panel beside it.</li>
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
              <li>Enter numeric parameter values in Output to run mode-frequency and Josephson phase-ZPF analysis automatically.</li>
              <li>For direct component parameters, use F/GHz for capacitances or H/GHz for inductances to enter either component values or E/h values in GHz.</li>
              <li>Use Sweep on parameter rows to explore values with sliders; chart wheel zoom uses Ctrl/Cmd, and Box zoom selects a plot region.</li>
              <li>Current analysis assumes well-posed C and L_inv matrices and does not include external loop flux or hidden variable reduction.</li>
              <li>Save and Load store the drawing as a cQEDraw JSON project.</li>
            </ol>
          </section>
        </div>
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
