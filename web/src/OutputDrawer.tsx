import { AlertCircle, Check, Copy, Info, LoaderCircle, X } from "lucide-react";
import type { Ref } from "react";

import { type SweepSample } from "./analysis";
import {
  AnalysisParameterPanel,
  JosephsonBranchSummary,
  ModalAnalysisTable,
} from "./AnalysisParameterPanel";
import { ModalAnalysisPlots } from "./ModalAnalysisPlots";
import type {
  ParameterInputMode,
  ParameterInputSpec,
} from "./parameterUnits";
import type {
  MultiSweepValidation,
  ParameterSweepConfig,
  ParameterSweepConfigs,
} from "./sweepState";
import type { ModalAnalysisResult, OutputResult } from "./types";
import type { TutorialStep } from "./tutorialFlow";

export type OutputDrawerState =
  | {
      kind: "empty" | "warming" | "generating" | "error";
      message: string;
      title: string;
    }
  | null;

export function OutputDrawer({
  activeSweepParameters,
  cachedSweepGridPointCount,
  displayedAnalysis,
  hasGeneratedSnippet,
  hasProjectContent,
  invalidParameterValues,
  missingParameterValues,
  missingSweepFixedValues,
  onClose,
  onCopySnippet,
  onExportAnalysisCsv,
  onParameterInputModeChange,
  onParameterValueChange,
  onSweepConfigChange,
  onSweepSliderChange,
  onSweepSliderInteraction,
  onTutorialPhaseZpfViewed,
  output,
  outputDrawerState,
  outputPanelRef,
  outputParameters,
  parameterInputError,
  parameterInputModes,
  parameterInputSpecs,
  parameterValues,
  snippetCopied,
  sweepConfig,
  sweepError,
  sweepModeActive,
  sweepPrecomputeRunning,
  sweepRunning,
  sweepSamples,
  sweepSliderValues,
  sweepValidation,
  tutorialStep,
}: {
  activeSweepParameters: string[];
  cachedSweepGridPointCount: number;
  displayedAnalysis: ModalAnalysisResult | null;
  hasGeneratedSnippet: boolean;
  hasProjectContent: boolean;
  invalidParameterValues: string[];
  missingParameterValues: string[];
  missingSweepFixedValues: string[];
  onClose: () => void;
  onCopySnippet: () => void;
  onExportAnalysisCsv: () => void;
  onParameterInputModeChange: (name: string, mode: ParameterInputMode) => void;
  onParameterValueChange: (name: string, value: string) => void;
  onSweepConfigChange: (
    name: string,
    updates: Partial<ParameterSweepConfig>,
  ) => void;
  onSweepSliderChange: (name: string, value: number) => void;
  onSweepSliderInteraction: () => void;
  onTutorialPhaseZpfViewed: () => void;
  output: OutputResult | null;
  outputDrawerState: OutputDrawerState;
  outputPanelRef: Ref<HTMLElement>;
  outputParameters: string[];
  parameterInputError: string | null;
  parameterInputModes: Record<string, ParameterInputMode>;
  parameterInputSpecs: Record<string, ParameterInputSpec>;
  parameterValues: Record<string, string>;
  snippetCopied: boolean;
  sweepConfig: ParameterSweepConfigs;
  sweepError: string | null;
  sweepModeActive: boolean;
  sweepPrecomputeRunning: boolean;
  sweepRunning: boolean;
  sweepSamples: SweepSample[];
  sweepSliderValues: Record<string, number>;
  sweepValidation: MultiSweepValidation;
  tutorialStep: TutorialStep | null;
}) {
  const outputBusy =
    outputDrawerState?.kind === "warming" ||
    outputDrawerState?.kind === "generating";
  return (
    <aside aria-label="Output" className="output-drawer" data-testid="output-drawer">
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
              onClick={onClose}
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
              <p>
                Matrices are prepared automatically; copy the Python snippet when
                needed.
              </p>
            </div>
            <div className="output-panel-actions">
              <button
                aria-label="Copy matrices"
                className={[
                  "output-action-button",
                  "output-copy-button",
                  tutorialStep === "copy" ? "tutorial-highlight-control" : "",
                ].join(" ")}
                disabled={!hasProjectContent || outputBusy}
                onClick={onCopySnippet}
                title={
                  outputBusy
                    ? "Matrices are still being prepared"
                    : hasGeneratedSnippet
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
          <OutputStateCard state={outputDrawerState} />
          <JosephsonBranchSummary branches={output?.josephson_branches ?? []} />
        </div>
        <div className="output-section output-section-analysis">
          <div className="analysis-workspace" data-testid="analysis-workspace">
            <div className="analysis-controls">
              <div className="output-section-heading analysis-section-heading">
                <div>
                  <h3>Frequencies and phase ZPF</h3>
                  <p>Analysis runs automatically when parameter values are complete.</p>
                </div>
              </div>
              <AnalysisParameterPanel
                activeSweepParameters={activeSweepParameters}
                cachedSweepGridPointCount={cachedSweepGridPointCount}
                disabled={!output}
                disabledMessage={
                  outputDrawerState
                    ? outputDrawerState.message
                    : "Open Output to prepare matrices for analysis."
                }
                fixedMissingParameters={missingSweepFixedValues}
                invalidParameters={invalidParameterValues}
                inputError={parameterInputError}
                inputModes={parameterInputModes}
                missingParameters={missingParameterValues}
                onInputModeChange={onParameterInputModeChange}
                onParameterChange={onParameterValueChange}
                onRangeChange={onSweepConfigChange}
                onSliderChange={onSweepSliderChange}
                onSliderInteraction={onSweepSliderInteraction}
                parameters={outputParameters}
                parameterSpecs={parameterInputSpecs}
                precomputeRunning={sweepPrecomputeRunning}
                running={sweepRunning}
                samples={sweepSamples}
                selectedValues={sweepSliderValues}
                sweepError={sweepError}
                tutorialStep={tutorialStep}
                validation={sweepValidation}
                values={parameterValues}
                sweepValues={sweepConfig}
              />
            </div>
            <div className="analysis-results" data-testid="analysis-results">
              <ModalAnalysisPlots
                placeholderAvailable={Boolean(output && outputParameters.length > 0)}
                placeholderZpfAvailable={Boolean(output?.josephson_branches?.length)}
                result={displayedAnalysis}
                tutorialStep={tutorialStep}
                onTutorialPhaseZpfViewed={onTutorialPhaseZpfViewed}
                yReferenceResults={
                  sweepModeActive ? sweepSamples.map((sample) => sample.analysis) : []
                }
              />
              <ModalAnalysisTable
                result={displayedAnalysis}
                onExportAnalysis={onExportAnalysisCsv}
              />
              {outputDrawerState ? (
                <div
                  className="output-results-placeholder"
                  data-testid="output-results-placeholder"
                >
                  {outputDrawerState.kind === "error"
                    ? "Fix the issue or retry matrix generation to run analysis."
                    : "Analysis results will appear here once matrices are ready."}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </aside>
  );
}

function OutputStateCard({ state }: { state: OutputDrawerState }) {
  if (!state) {
    return null;
  }

  const Icon =
    state.kind === "error"
      ? AlertCircle
      : state.kind === "empty"
        ? Info
        : LoaderCircle;
  return (
    <div
      className={[
        "output-state-card",
        `output-state-card-${state.kind}`,
      ].join(" ")}
      data-testid={
        state.kind === "error"
          ? "output-generation-error"
          : "output-generation-state"
      }
      role={state.kind === "error" ? "alert" : "status"}
    >
      <span className="output-state-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="output-state-copy">
        <strong>{state.title}</strong>
        <span>{state.message}</span>
      </span>
    </div>
  );
}
