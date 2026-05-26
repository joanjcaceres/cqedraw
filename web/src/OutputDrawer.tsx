import { Check, Copy, X } from "lucide-react";
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

export function OutputDrawer({
  activeSweepParameters,
  analysisRunning,
  cachedSweepGridPointCount,
  displayedAnalysis,
  hasGeneratedSnippet,
  hasProjectContent,
  missingParameterValues,
  missingSweepFixedValues,
  onClose,
  onCopySnippet,
  onExportAnalysisCsv,
  onParameterInputModeChange,
  onParameterValueChange,
  onRunModalAnalysis,
  onSweepConfigChange,
  onSweepSliderChange,
  onSweepSliderInteraction,
  output,
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
  analysisRunning: boolean;
  cachedSweepGridPointCount: number;
  displayedAnalysis: ModalAnalysisResult | null;
  hasGeneratedSnippet: boolean;
  hasProjectContent: boolean;
  missingParameterValues: string[];
  missingSweepFixedValues: string[];
  onClose: () => void;
  onCopySnippet: () => void;
  onExportAnalysisCsv: () => void;
  onParameterInputModeChange: (name: string, mode: ParameterInputMode) => void;
  onParameterValueChange: (name: string, value: string) => void;
  onRunModalAnalysis: () => void;
  onSweepConfigChange: (
    name: string,
    updates: Partial<ParameterSweepConfig>,
  ) => void;
  onSweepSliderChange: (name: string, value: number) => void;
  onSweepSliderInteraction: () => void;
  output: OutputResult | null;
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
                disabled={!hasProjectContent}
                onClick={onCopySnippet}
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
                onAnalyze={onRunModalAnalysis}
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
                yReferenceResults={
                  sweepModeActive ? sweepSamples.map((sample) => sample.analysis) : []
                }
              />
              <ModalAnalysisTable
                result={displayedAnalysis}
                onExportAnalysis={onExportAnalysisCsv}
              />
            </div>
          </div>
        </div>
      </section>
    </aside>
  );
}
