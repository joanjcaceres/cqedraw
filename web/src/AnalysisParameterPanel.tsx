import { Download, Repeat2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type SweepSample, type SweepScale } from "./analysis";
import { formatModalNumber } from "./csvExport";
import {
  type ParameterInputMode,
  type ParameterInputSpec,
} from "./parameterUnits";
import {
  INITIAL_PARAMETER_SWEEP_CONFIG,
  nearestSweepValueIndex,
  type MultiSweepValidation,
  type ParameterSweepConfig,
  type ParameterSweepConfigs,
} from "./sweepState";
import { type ModalAnalysisResult, type OutputResult } from "./types";

const SWEEP_SLIDER_COMMIT_DELAY_MS = 75;

export function JosephsonBranchSummary({
  branches,
}: {
  branches: OutputResult["josephson_branches"];
}) {
  if (branches.length === 0) {
    return null;
  }

  return (
    <p className="jj-branch-summary" data-testid="jj-branches">
      {branches.length} Josephson branch{branches.length === 1 ? "" : "es"} included
      in the copied Python snippet.
    </p>
  );
}

export function AnalysisParameterPanel({
  activeSweepParameters,
  analysisRunning,
  cachedSweepGridPointCount,
  disabled,
  fixedMissingParameters,
  inputError,
  inputModes,
  missingParameters,
  onAnalyze,
  onInputModeChange,
  onParameterChange,
  onRangeChange,
  onSliderChange,
  onSliderInteraction,
  parameters,
  parameterSpecs,
  precomputeRunning,
  running,
  samples,
  selectedValues,
  sweepError,
  validation,
  values,
  sweepValues,
}: {
  activeSweepParameters: string[];
  analysisRunning: boolean;
  cachedSweepGridPointCount: number;
  disabled: boolean;
  fixedMissingParameters: string[];
  inputError: string | null;
  inputModes: Record<string, ParameterInputMode>;
  missingParameters: string[];
  onAnalyze: () => void;
  onInputModeChange: (name: string, mode: ParameterInputMode) => void;
  onParameterChange: (name: string, value: string) => void;
  onRangeChange: (name: string, updates: Partial<ParameterSweepConfig>) => void;
  onSliderChange: (name: string, value: number) => void;
  onSliderInteraction: () => void;
  parameters: string[];
  parameterSpecs: Record<string, ParameterInputSpec>;
  precomputeRunning: boolean;
  running: boolean;
  samples: SweepSample[];
  selectedValues: Record<string, number>;
  sweepError: string | null;
  validation: MultiSweepValidation;
  values: Record<string, string>;
  sweepValues: ParameterSweepConfigs;
}) {
  const missingParameterSet = new Set(missingParameters);
  const actionDisabled = disabled || missingParameters.length > 0 || Boolean(inputError);
  const refreshDisabled = actionDisabled || analysisRunning;
  const missingMessage =
    missingParameters.length > 0
      ? `Enter values for: ${missingParameters.join(", ")}`
      : "";
  const fixedMissingMessage =
    fixedMissingParameters.length > 0
      ? `Enter fixed values for: ${fixedMissingParameters.join(", ")}`
      : "";
  const parameterWarningMessage =
    inputError ??
    (activeSweepParameters.length > 0 ? fixedMissingMessage : missingMessage);
  const sweepValidationMessage =
    disabled
      ? ""
      : parameters.length === 0
        ? "Prepare matrices with at least one parameter to sweep."
        : inputError
          ? inputError
          : activeSweepParameters.length === 0
            ? "Select Sweep on any parameter to enable sliders."
            : fixedMissingMessage || validation.error || sweepError || "";
  return (
    <div className="parameter-panel analysis-parameter-panel" data-testid="analysis-parameter-panel">
      <div className="parameter-panel-heading">
        <h3>Parameter values</h3>
        <div className="parameter-panel-actions">
          <button
            disabled={refreshDisabled}
            onClick={onAnalyze}
            title={missingMessage}
            type="button"
          >
            <Repeat2 size={14} />
            {analysisRunning ? "Analyzing..." : "Refresh"}
          </button>
        </div>
      </div>
      {disabled ? (
        <p data-testid="parameter-empty">Open Output to prepare matrices for analysis.</p>
      ) : parameters.length === 0 ? (
        <p data-testid="parameter-empty">No parameters.</p>
      ) : (
        <>
          {parameterWarningMessage ? (
            <p
              className="parameter-panel-warning"
              data-testid="parameter-required-message"
            >
              {parameterWarningMessage}
            </p>
          ) : null}
          <div className="parameter-grid parameter-mode-grid" data-testid="parameter-values">
            {parameters.map((name) => (
              <ParameterControlRow
                key={name}
                disabled={disabled}
                inputMode={inputModes[name] ?? "physical"}
                missing={missingParameterSet.has(name)}
                name={name}
                onInputModeChange={onInputModeChange}
                onParameterChange={onParameterChange}
                onRangeChange={onRangeChange}
                onSliderChange={onSliderChange}
                onSliderInteraction={onSliderInteraction}
                range={sweepValues[name] ?? INITIAL_PARAMETER_SWEEP_CONFIG}
                selectedSweepValue={selectedValues[name]}
                spec={parameterSpecs[name]}
                sweepValues={validation.parameterValues[name] ?? []}
                value={values[name] ?? ""}
              />
            ))}
          </div>
        </>
      )}
      <div className="parameter-sweep" data-testid="parameter-sweep">
        <div className="parameter-panel-heading">
          <h3>Parameter sweep</h3>
        </div>
        {sweepValidationMessage ? (
          <p className="parameter-panel-warning" data-testid="sweep-validation-message">
            {sweepValidationMessage}
          </p>
        ) : running ? (
          <p className="sweep-summary" data-testid="sweep-running-message">
            Calculating selected sweep point...
          </p>
        ) : validation.totalCombinations > 0 ? (
          <p className="sweep-summary" data-testid="sweep-point-count">
            {validation.totalCombinations} slider combination
            {validation.totalCombinations === 1 ? "" : "s"} available.
            Background cache: up to {validation.precomputeLimit} nearby point
            {validation.precomputeLimit === 1 ? "" : "s"}.
          </p>
        ) : null}
        {samples.length > 0 ? (
          <p className="sweep-summary" data-testid="sweep-result-summary">
            Cached points: {cachedSweepGridPointCount} / {validation.totalCombinations}.
            {precomputeRunning ? " Precomputing..." : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ParameterControlRow({
  disabled,
  inputMode,
  missing,
  name,
  onInputModeChange,
  onParameterChange,
  onRangeChange,
  onSliderChange,
  onSliderInteraction,
  range,
  selectedSweepValue,
  spec,
  sweepValues,
  value,
}: {
  disabled: boolean;
  inputMode: ParameterInputMode;
  missing: boolean;
  name: string;
  onInputModeChange: (name: string, mode: ParameterInputMode) => void;
  onParameterChange: (name: string, value: string) => void;
  onRangeChange: (name: string, updates: Partial<ParameterSweepConfig>) => void;
  onSliderChange: (name: string, value: number) => void;
  onSliderInteraction: () => void;
  range: ParameterSweepConfig;
  selectedSweepValue: number | undefined;
  spec: ParameterInputSpec | undefined;
  sweepValues: number[];
  value: string;
}) {
  const [localSliderDraft, setLocalSliderDraft] = useState<{
    index: number;
    value: number;
  } | null>(null);
  const sliderCommitTimerRef = useRef<number | null>(null);
  const displayedSweepValue =
    localSliderDraft?.value ?? selectedSweepValue ?? sweepValues[0];
  const [manualSweepValueText, setManualSweepValueText] = useState(() =>
    displayedSweepValue === undefined ? "" : formatModalNumber(displayedSweepValue),
  );
  const [manualSweepValueFocused, setManualSweepValueFocused] = useState(false);
  const committedSelectedIndex =
    (selectedSweepValue ?? sweepValues[0]) === undefined
      ? 0
      : nearestSweepValueIndex(sweepValues, selectedSweepValue ?? sweepValues[0]);
  const selectedIndex = localSliderDraft?.index ?? committedSelectedIndex;
  const previousFixedValue = value.trim();
  const sweepReferenceValue = previousFixedValue
    ? `Previous: ${previousFixedValue}`
    : "Controlled by sweep";
  const sweepScale = range.scale ?? "linear";
  const stepLabel = sweepScale === "log" ? "Points/decade" : "Step";
  const stepPlaceholder = sweepScale === "log" ? "points" : "step";
  const hasEnergyMode = Boolean(spec?.kind && spec.energyLabel);
  const valueLabel =
    inputMode === "energy" && spec?.energyLabel ? spec.energyLabel : name;
  const activeUnit =
    inputMode === "energy" ? spec?.energyUnit : spec?.physicalUnit;
  const inputPlaceholder =
    inputMode === "energy" && spec?.energyLabel
      ? `${spec.energyLabel}/h in ${spec.energyUnit}`
      : "required";

  useEffect(() => {
    setLocalSliderDraft(null);
  }, [selectedSweepValue, sweepValues]);

  useEffect(() => {
    if (!manualSweepValueFocused) {
      setManualSweepValueText(
        displayedSweepValue === undefined ? "" : formatModalNumber(displayedSweepValue),
      );
    }
  }, [displayedSweepValue, manualSweepValueFocused]);

  useEffect(
    () => () => {
      if (sliderCommitTimerRef.current !== null) {
        window.clearTimeout(sliderCommitTimerRef.current);
      }
    },
    [],
  );

  function clearScheduledSliderCommit() {
    if (sliderCommitTimerRef.current !== null) {
      window.clearTimeout(sliderCommitTimerRef.current);
      sliderCommitTimerRef.current = null;
    }
  }

  function commitSliderValue(nextValue: number) {
    clearScheduledSliderCommit();
    onSliderChange(name, nextValue);
  }

  function scheduleSliderCommit(nextValue: number) {
    clearScheduledSliderCommit();
    sliderCommitTimerRef.current = window.setTimeout(() => {
      sliderCommitTimerRef.current = null;
      onSliderChange(name, nextValue);
    }, SWEEP_SLIDER_COMMIT_DELAY_MS);
  }

  function flushLocalSliderValue() {
    if (!localSliderDraft) {
      return;
    }
    commitSliderValue(localSliderDraft.value);
  }

  function handleSliderInput(nextIndex: number) {
    const nextValue = sweepValues[nextIndex];
    if (nextValue === undefined) {
      return;
    }
    setLocalSliderDraft({ index: nextIndex, value: nextValue });
    if (!manualSweepValueFocused) {
      setManualSweepValueText(formatModalNumber(nextValue));
    }
    onSliderInteraction();
    scheduleSliderCommit(nextValue);
  }

  function commitManualSweepValue() {
    const parsedValue = Number(manualSweepValueText);
    if (!Number.isFinite(parsedValue)) {
      setManualSweepValueText(
        displayedSweepValue === undefined ? "" : formatModalNumber(displayedSweepValue),
      );
      return;
    }
    setLocalSliderDraft(null);
    commitSliderValue(parsedValue);
    setManualSweepValueText(formatModalNumber(parsedValue));
  }

  return (
    <div className="parameter-control-row">
      <div className="parameter-control-main">
        <label>
          <span>{name}</span>
          <input
            aria-invalid={!range.enabled && missing ? true : undefined}
            aria-label={`Value for ${name}`}
            className={range.enabled ? "parameter-sweep-reference-input" : undefined}
            disabled={disabled || range.enabled}
            inputMode="decimal"
            onChange={(event) => onParameterChange(name, event.target.value)}
            placeholder={inputPlaceholder}
            required={!range.enabled}
            value={range.enabled ? sweepReferenceValue : value}
          />
        </label>
        {hasEnergyMode ? (
          <div
            aria-label={`Input representation for ${name}`}
            className="parameter-unit-toggle"
            role="group"
          >
            <button
              aria-pressed={inputMode === "physical"}
              disabled={disabled}
              onClick={() => onInputModeChange(name, "physical")}
              title={`Use ${spec?.physicalLabel} in ${spec?.physicalUnit}`}
              type="button"
            >
              {spec?.physicalLabel}
            </button>
            <button
              aria-pressed={inputMode === "energy"}
              disabled={disabled}
              onClick={() => onInputModeChange(name, "energy")}
              title={`Use ${spec?.energyLabel}/h in ${spec?.energyUnit}`}
              type="button"
            >
              {spec?.energyLabel}
            </button>
          </div>
        ) : null}
        <label className="parameter-sweep-toggle">
          <input
            aria-label={`Sweep ${name}`}
            checked={range.enabled}
            disabled={disabled}
            onChange={(event) =>
              onRangeChange(name, { enabled: event.target.checked })
            }
            type="checkbox"
          />
          <span>Sweep</span>
        </label>
      </div>
      {range.enabled ? (
        <>
          <div className="sweep-grid parameter-range-grid">
            <label>
              <span>Scale</span>
              <select
                aria-label={`Sweep scale for ${name}`}
                disabled={disabled}
                onChange={(event) =>
                  onRangeChange(name, {
                    scale: event.target.value as SweepScale,
                  })
                }
                value={sweepScale}
              >
                <option value="linear">Linear</option>
                <option value="log">Log</option>
              </select>
            </label>
            <label>
              <span>Min</span>
              <input
                aria-label={`Sweep min for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onRangeChange(name, { min: event.target.value })}
                placeholder="min"
                value={range.min}
              />
            </label>
            <label>
              <span>Max</span>
              <input
                aria-label={`Sweep max for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onRangeChange(name, { max: event.target.value })}
                placeholder="max"
                value={range.max}
              />
            </label>
            <label>
              <span>{stepLabel}</span>
              <input
                aria-label={`Sweep step for ${name}`}
                disabled={disabled}
                inputMode="decimal"
                onChange={(event) => onRangeChange(name, { step: event.target.value })}
                placeholder={stepPlaceholder}
                value={range.step}
              />
            </label>
          </div>
          {sweepValues.length > 0 ? (
            <div className="sweep-sample-slider">
              <label className="sweep-manual-value">
                <span>
                  {valueLabel}
                  {activeUnit ? <small>{activeUnit}</small> : null}
                </span>
                <input
                  aria-label={`Selected sweep value for ${name}`}
                  disabled={disabled}
                  inputMode="decimal"
                  onBlur={() => {
                    setManualSweepValueFocused(false);
                    commitManualSweepValue();
                  }}
                  onChange={(event) =>
                    setManualSweepValueText(event.target.value)
                  }
                  onFocus={() => setManualSweepValueFocused(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  value={manualSweepValueText}
                />
              </label>
              <input
                aria-label={`Sweep sample for ${name}`}
                data-testid={`sweep-sample-slider-${name}`}
                disabled={disabled}
                max={sweepValues.length - 1}
                min={0}
                onBlur={flushLocalSliderValue}
                onChange={(event) =>
                  handleSliderInput(Number(event.currentTarget.value))
                }
                onKeyUp={flushLocalSliderValue}
                onPointerDown={onSliderInteraction}
                onPointerUp={flushLocalSliderValue}
                step={1}
                type="range"
                value={selectedIndex}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ModalAnalysisTable({
  onExportAnalysis,
  result,
}: {
  onExportAnalysis: () => void;
  result: ModalAnalysisResult | null;
}) {
  if (!result?.available) {
    return null;
  }

  const frequencies = result.frequencies_ghz ?? [];
  const branches = result.branches ?? [];
  const modeCount = Math.max(
    frequencies.length,
    ...branches.map((branch) => branch.phase_zpf.length),
  );
  const collapseByDefault = branches.length > 6 || frequencies.length > 16;
  const modeCountText = `${modeCount} mode${modeCount === 1 ? "" : "s"}`;
  const branchCountText =
    branches.length > 0
      ? `, ${branches.length} JJ column${branches.length === 1 ? "" : "s"}`
      : "";
  return (
    <details
      className="modal-analysis"
      data-testid="modal-analysis"
      open={!collapseByDefault}
    >
      <summary className="modal-analysis-summary">
        <span className="modal-analysis-summary-title">
          <h3>BBQ modal results</h3>
          {collapseByDefault ? (
            <span className="modal-analysis-summary-note">
              Large result; use Export CSV for the full table.
            </span>
          ) : null}
        </span>
        <span className="modal-analysis-summary-right">
          <span className="modal-analysis-summary-meta">
            {modeCountText}
            {branchCountText}
          </span>
          <button
            className="modal-analysis-export-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onExportAnalysis();
            }}
            type="button"
          >
            <Download size={14} />
            Export CSV
          </button>
        </span>
      </summary>
      <div className="modal-analysis-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>frequency GHz</th>
              {branches.map((branch, branchIndex) => (
                <th key={branch.edge_id ?? branchIndex}>
                  edge {branch.edge_id ?? branchIndex} phase{" "}
                  {branch.phase_nodes[0] ?? "GND"} -{" "}
                  {branch.phase_nodes[1] ?? "GND"}
                  <span className="modal-analysis-branch-note">
                    Ej {formatModalNumber(branch.E_j_GHz)} GHz
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: modeCount }, (_, modeIndex) => (
              <tr key={modeIndex}>
                <th>mode {modeIndex}</th>
                <td>
                  {frequencies[modeIndex] === undefined
                    ? ""
                    : formatModalNumber(frequencies[modeIndex])}
                </td>
                {branches.map((branch, branchIndex) => {
                  const zpf = branch.phase_zpf[modeIndex];
                  return (
                    <td key={branch.edge_id ?? branchIndex}>
                      {zpf === undefined ? "" : formatModalNumber(zpf)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
