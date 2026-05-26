import { useEffect, useState } from "react";

import {
  absoluteChartSeries,
  buildCurrentFrequencySeries,
  buildCurrentZpfSeries,
  referenceFrequencyYBounds,
  referenceZpfYBounds,
} from "./analysis";
import { AnalysisLineChart } from "./AnalysisLineChart";
import type { ModalAnalysisResult } from "./types";

export function ModalAnalysisPlots({
  frequencyTestId = "frequency-mode-plot",
  frequencyTitle = "Mode frequencies",
  placeholderAvailable = false,
  placeholderZpfAvailable = false,
  result,
  yReferenceResults = [],
  zpfTestId = "zpf-mode-plot",
  zpfTitle = "JJ phase ZPF",
}: {
  frequencyTestId?: string;
  frequencyTitle?: string;
  placeholderAvailable?: boolean;
  placeholderZpfAvailable?: boolean;
  result: ModalAnalysisResult | null;
  yReferenceResults?: ModalAnalysisResult[];
  zpfTestId?: string;
  zpfTitle?: string;
}) {
  type AnalysisPlotTab = "frequency" | "zpf";
  type ZpfValueMode = "signed" | "absolute";
  const [activePlot, setActivePlot] = useState<AnalysisPlotTab>("frequency");
  const [zpfValueMode, setZpfValueMode] =
    useState<ZpfValueMode>("signed");
  const frequencySeries = result?.available ? buildCurrentFrequencySeries(result) : [];
  const zpfSeries = result?.available ? buildCurrentZpfSeries(result) : [];
  const displayedZpfSeries =
    zpfValueMode === "absolute" ? absoluteChartSeries(zpfSeries) : zpfSeries;
  const hasFrequencyPlot = frequencySeries.some((entry) => entry.points.length > 0);
  const hasZpfPlot = zpfSeries.some((entry) => entry.points.length > 0);
  const referenceResults = yReferenceResults.filter((entry) => entry.available);

  useEffect(() => {
    if (activePlot === "zpf" && !hasZpfPlot && hasFrequencyPlot) {
      setActivePlot("frequency");
    }
    if (activePlot === "frequency" && !hasFrequencyPlot && hasZpfPlot) {
      setActivePlot("zpf");
    }
  }, [activePlot, hasFrequencyPlot, hasZpfPlot]);

  if (!result?.available) {
    if (!placeholderAvailable) {
      return null;
    }
    const selectedPlaceholder =
      activePlot === "zpf" && placeholderZpfAvailable ? "zpf" : "frequency";
    return (
      <div className="analysis-plots" data-testid="modal-analysis-plots">
        {placeholderZpfAvailable ? (
          <div
            aria-label="Analysis plot"
            className="analysis-plot-tabs"
            data-testid="analysis-plot-tabs"
            role="tablist"
          >
            <button
              aria-controls={`${frequencyTestId}-placeholder-panel`}
              aria-selected={selectedPlaceholder === "frequency"}
              data-testid="analysis-plot-tab-frequency"
              onClick={() => setActivePlot("frequency")}
              role="tab"
              type="button"
            >
              Frequencies
            </button>
            <button
              aria-controls={`${zpfTestId}-placeholder-panel`}
              aria-selected={selectedPlaceholder === "zpf"}
              data-testid="analysis-plot-tab-zpf"
              onClick={() => setActivePlot("zpf")}
              role="tab"
              type="button"
            >
              Phase ZPF
            </button>
          </div>
        ) : null}
        {selectedPlaceholder === "frequency" ? (
          <div id={`${frequencyTestId}-placeholder-panel`} role="tabpanel">
            <AnalysisChartPlaceholder
              testId={`${frequencyTestId}-placeholder`}
              title={frequencyTitle}
              xLabel="mode index"
              yLabel="frequency GHz"
            />
          </div>
        ) : (
          <div id={`${zpfTestId}-placeholder-panel`} role="tabpanel">
            <AnalysisChartPlaceholder
              testId={`${zpfTestId}-placeholder`}
              title={zpfTitle}
              xLabel="mode index"
              yLabel="phase ZPF"
            />
          </div>
        )}
      </div>
    );
  }

  if (!hasFrequencyPlot && !hasZpfPlot) {
    return null;
  }

  const showPlotTabs = hasFrequencyPlot && hasZpfPlot;
  const selectedPlot = activePlot === "zpf" && hasZpfPlot ? "zpf" : "frequency";

  return (
    <div className="analysis-plots" data-testid="modal-analysis-plots">
      {showPlotTabs ? (
        <div
          aria-label="Analysis plot"
          className="analysis-plot-tabs"
          data-testid="analysis-plot-tabs"
          role="tablist"
        >
          <button
            aria-controls={`${frequencyTestId}-panel`}
            aria-selected={selectedPlot === "frequency"}
            data-testid="analysis-plot-tab-frequency"
            onClick={() => setActivePlot("frequency")}
            role="tab"
            type="button"
          >
            Frequencies
          </button>
          <button
            aria-controls={`${zpfTestId}-panel`}
            aria-selected={selectedPlot === "zpf"}
            data-testid="analysis-plot-tab-zpf"
            onClick={() => setActivePlot("zpf")}
            role="tab"
            type="button"
          >
            Phase ZPF
          </button>
        </div>
      ) : null}
      {selectedPlot === "frequency" && hasFrequencyPlot ? (
        <div id={`${frequencyTestId}-panel`} role="tabpanel">
          <AnalysisLineChart
            referenceYBoundsForSeries={() =>
              referenceFrequencyYBounds(referenceResults)
            }
            series={frequencySeries}
            testId={frequencyTestId}
            title={frequencyTitle}
            xLabel="mode index"
            yLabel="frequency GHz"
          />
        </div>
      ) : null}
      {selectedPlot === "zpf" && hasZpfPlot ? (
        <div id={`${zpfTestId}-panel`} role="tabpanel">
          <AnalysisLineChart
            referenceYBoundsForSeries={(seriesKeys) =>
              referenceZpfYBounds(
                referenceResults,
                seriesKeys,
                zpfValueMode === "absolute",
              )
            }
            series={displayedZpfSeries}
            seriesSelectThreshold={1}
            testId={zpfTestId}
            title={zpfTitle}
            xLabel="mode index"
            valueModeControl={
              <div
                aria-label={`${zpfTitle} value mode`}
                className="analysis-chart-value-mode"
                role="group"
              >
                <button
                  aria-pressed={zpfValueMode === "signed"}
                  data-testid={`${zpfTestId}-signed-values`}
                  onClick={() => setZpfValueMode("signed")}
                  type="button"
                >
                  Signed
                </button>
                <button
                  aria-pressed={zpfValueMode === "absolute"}
                  data-testid={`${zpfTestId}-absolute-values`}
                  onClick={() => setZpfValueMode("absolute")}
                  type="button"
                >
                  Abs
                </button>
              </div>
            }
            yLabel={zpfValueMode === "absolute" ? "|phase ZPF|" : "phase ZPF"}
          />
        </div>
      ) : null}
    </div>
  );
}

function AnalysisChartPlaceholder({
  testId,
  title,
  xLabel,
  yLabel,
}: {
  testId: string;
  title: string;
  xLabel: string;
  yLabel: string;
}) {
  const viewWidth = 760;
  const viewHeight = 370;
  const plot = {
    bottom: 320,
    left: 96,
    right: 736,
    top: 22,
  };
  const xTicks = [0, 25, 50, 75, 100];
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const xScale = (value: number) => plot.left + (value / 100) * plotWidth;
  const yScale = (value: number) => plot.bottom - value * plotHeight;

  return (
    <div
      className="analysis-chart analysis-chart-placeholder"
      data-testid={testId}
    >
      <div className="analysis-chart-heading">
        <h3>{title}</h3>
      </div>
      <svg
        aria-label={`${title} placeholder`}
        role="img"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      >
        <rect
          className="analysis-chart-plot-bg"
          height={plotHeight}
          rx="4"
          width={plotWidth}
          x={plot.left}
          y={plot.top}
        />
        {xTicks.map((tick) => {
          const x = xScale(tick);
          return (
            <line
              className="analysis-chart-grid"
              key={`x-${tick}`}
              x1={x}
              x2={x}
              y1={plot.top}
              y2={plot.bottom}
            />
          );
        })}
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <line
              className="analysis-chart-grid"
              key={`y-${tick}`}
              x1={plot.left}
              x2={plot.right}
              y1={y}
              y2={y}
            />
          );
        })}
        <line
          className="analysis-chart-zero-line"
          x1={plot.left}
          x2={plot.right}
          y1={yScale(0)}
          y2={yScale(0)}
        />
        <line
          className="analysis-chart-axis"
          x1={plot.left}
          x2={plot.right}
          y1={plot.bottom}
          y2={plot.bottom}
        />
        <line
          className="analysis-chart-axis"
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={plot.bottom}
        />
        <text
          className="analysis-chart-axis-label"
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={354}
        >
          {xLabel}
        </text>
        <text
          className="analysis-chart-axis-label"
          textAnchor="middle"
          transform={`translate(22 ${(plot.top + plot.bottom) / 2}) rotate(-90)`}
        >
          {yLabel}
        </text>
      </svg>
    </div>
  );
}
