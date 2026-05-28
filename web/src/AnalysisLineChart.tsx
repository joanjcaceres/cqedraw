import { BoxSelect, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import {
  chartBounds,
  type ChartBounds,
  type ChartPoint,
  type ChartSeries,
  type ChartYBounds,
} from "./analysis";
import {
  chartColor,
  chartTicks,
  chartTooltipPosition,
  formatChartTick,
  integerChartTicks,
  parseManualChartYBounds,
  pointsToPath,
  zoomChartBounds,
} from "./chartMath";
import { formatModalNumber } from "./csvExport";
import { clamp } from "./viewBox";

export function AnalysisLineChart({
  plotSelectorControl,
  referenceYBoundsForSeries,
  series,
  seriesSelectThreshold = 6,
  testId,
  title,
  valueModeControl,
  xLabel,
  yLabel,
}: {
  plotSelectorControl?: ReactNode;
  referenceYBoundsForSeries?: (seriesKeys: string[]) => ChartYBounds | null;
  series: ChartSeries[];
  seriesSelectThreshold?: number;
  testId: string;
  title: string;
  valueModeControl?: ReactNode;
  xLabel: string;
  yLabel: string;
}) {
  type ChartAxisMode = "auto" | "fixed" | "manual";
  type ChartInteractionMode = "pan" | "boxZoom";
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [boxZoomCurrent, setBoxZoomCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [boxZoomStart, setBoxZoomStart] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    color: string;
    point: ChartPoint;
    seriesLabel: string;
  } | null>(null);
  const [interactionMode, setInteractionMode] =
    useState<ChartInteractionMode>("pan");
  const [manualYMaxText, setManualYMaxText] = useState("");
  const [manualYMinText, setManualYMinText] = useState("");
  const [panStart, setPanStart] = useState<{
    domain: ChartBounds;
    x: number;
    y: number;
  } | null>(null);
  const [comparisonSeriesKeys, setComparisonSeriesKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string>("__first__");
  const [showAllSeries, setShowAllSeries] = useState(false);
  const [yAxisMode, setYAxisMode] = useState<ChartAxisMode>("fixed");
  const [zoomDomain, setZoomDomain] = useState<ChartBounds | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const populatedSeries = series.filter((entry) => entry.points.length > 0);
  if (populatedSeries.length === 0) {
    return null;
  }

  const useSeriesSelect = populatedSeries.length > seriesSelectThreshold;
  const activeSelectedSeriesKey =
    populatedSeries.some((entry) => entry.key === selectedSeriesKey)
      ? selectedSeriesKey
      : populatedSeries[0].key;
  const populatedSeriesKeys = new Set(populatedSeries.map((entry) => entry.key));
  const comparisonKeys = Array.from(comparisonSeriesKeys).filter((key) =>
    populatedSeriesKeys.has(key),
  );
  const activeComparisonKeys =
    comparisonKeys.length > 0 ? comparisonKeys : [activeSelectedSeriesKey];
  const visibleSeries = useSeriesSelect
    ? showAllSeries
      ? populatedSeries
      : populatedSeries.filter((entry) => activeComparisonKeys.includes(entry.key))
    : populatedSeries.filter((entry) => !hiddenKeys.has(entry.key));
  const plottedSeries = visibleSeries.length > 0 ? visibleSeries : populatedSeries;
  const visibleSeriesKeys = plottedSeries.map((entry) => entry.key);
  const referenceYBounds = referenceYBoundsForSeries?.(visibleSeriesKeys) ?? null;
  const hasReferenceY = Boolean(referenceYBounds);
  const effectiveYAxisMode =
    yAxisMode === "fixed" && !hasReferenceY ? "auto" : yAxisMode;
  const manualYBounds = parseManualChartYBounds(manualYMinText, manualYMaxText);
  const bounds = chartBounds(
    plottedSeries,
    [],
    effectiveYAxisMode === "manual" && manualYBounds.bounds
      ? manualYBounds.bounds
      : undefined,
    effectiveYAxisMode === "fixed" ? referenceYBounds : null,
    true,
  );
  const displayBounds = zoomDomain ?? bounds;
  const xTicks =
    xLabel === "mode index"
      ? integerChartTicks(displayBounds.minX, displayBounds.maxX)
      : chartTicks(displayBounds.minX, displayBounds.maxX);
  const yTicks = chartTicks(displayBounds.minY, displayBounds.maxY);
  const viewWidth = 760;
  const viewHeight = 340;
  const plot = {
    bottom: 294,
    left: 96,
    right: 736,
    top: 18,
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const xScale = (value: number) =>
    plot.left +
    ((value - displayBounds.minX) / (displayBounds.maxX - displayBounds.minX)) *
      plotWidth;
  const yScale = (value: number) =>
    plot.bottom -
    ((value - displayBounds.minY) / (displayBounds.maxY - displayBounds.minY)) *
      plotHeight;
  const clipPathId = `${testId}-clip`;
  const manualAxisMessage =
    effectiveYAxisMode === "manual" && manualYBounds.error
      ? manualYBounds.error
      : "";
  const zeroLineVisible = displayBounds.minY <= 0 && displayBounds.maxY >= 0;

  function toggleSeries(key: string) {
    setHiddenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function focusSeries(key: string) {
    setComparisonSeriesKeys((current) => {
      if (showAllSeries || current.size > 0) {
        return current;
      }
      return new Set([activeSelectedSeriesKey]);
    });
    setSelectedSeriesKey(key);
    setHoveredPoint(null);
  }

  function showFocusedSeries() {
    setShowAllSeries(false);
    setComparisonSeriesKeys(new Set([activeSelectedSeriesKey]));
    setHoveredPoint(null);
    setZoomDomain(null);
  }

  function addFocusedSeries() {
    setShowAllSeries(false);
    setComparisonSeriesKeys((current) => {
      const next = new Set(current);
      next.add(activeSelectedSeriesKey);
      return next;
    });
    setHoveredPoint(null);
    setZoomDomain(null);
  }

  function showAllTraces() {
    setShowAllSeries(true);
    setHoveredPoint(null);
    setZoomDomain(null);
  }

  function removeComparisonSeries(key: string) {
    setShowAllSeries(false);
    setComparisonSeriesKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      if (next.size === 0) {
        next.add(activeSelectedSeriesKey);
      }
      return next;
    });
    setHoveredPoint(null);
    setZoomDomain(null);
  }

  function changeYAxisMode(mode: ChartAxisMode) {
    setYAxisMode(mode);
    setZoomDomain(null);
  }

  function showPointTooltip(point: ChartPoint, seriesLabel: string, color: string) {
    setHoveredPoint({
      color,
      point,
      seriesLabel,
    });
  }

  function updateManualYMin(value: string) {
    setManualYMinText(value);
    setZoomDomain(null);
  }

  function updateManualYMax(value: string) {
    setManualYMaxText(value);
    setZoomDomain(null);
  }

  function svgPositionFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: ((clientX - rect.left) / rect.width) * viewWidth,
      y: ((clientY - rect.top) / rect.height) * viewHeight,
    };
  }

  function plotPositionFromClient(clientX: number, clientY: number) {
    const position = svgPositionFromClient(clientX, clientY);
    if (!position) {
      return null;
    }
    return {
      x: clamp(position.x, plot.left, plot.right),
      y: clamp(position.y, plot.top, plot.bottom),
    };
  }

  function chartDataPointFromSvgPosition(
    position: { x: number; y: number },
    domain: ChartBounds,
  ) {
    return {
      x:
        domain.minX +
        ((position.x - plot.left) / plotWidth) * (domain.maxX - domain.minX),
      y:
        domain.minY +
        ((plot.bottom - position.y) / plotHeight) * (domain.maxY - domain.minY),
    };
  }

  function zoomChart(factor: number, center?: { x: number; y: number }) {
    const currentDomain = zoomDomain ?? displayBounds;
    const centerPoint = center
      ? chartDataPointFromSvgPosition(center, currentDomain)
      : {
          x: (currentDomain.minX + currentDomain.maxX) / 2,
          y: (currentDomain.minY + currentDomain.maxY) / 2,
        };
    setZoomDomain(zoomChartBounds(currentDomain, centerPoint, factor));
  }

  function toggleInteractionMode(mode: ChartInteractionMode) {
    setInteractionMode((current) => (current === mode ? "pan" : mode));
    setBoxZoomCurrent(null);
    setBoxZoomStart(null);
    setPanStart(null);
  }

  function finishBoxZoom(clientX: number, clientY: number) {
    if (!boxZoomStart) {
      return;
    }
    const endPosition =
      plotPositionFromClient(clientX, clientY) ?? boxZoomCurrent ?? boxZoomStart;
    const minSvgX = Math.min(boxZoomStart.x, endPosition.x);
    const maxSvgX = Math.max(boxZoomStart.x, endPosition.x);
    const minSvgY = Math.min(boxZoomStart.y, endPosition.y);
    const maxSvgY = Math.max(boxZoomStart.y, endPosition.y);
    setBoxZoomCurrent(null);
    setBoxZoomStart(null);

    if (maxSvgX - minSvgX < 8 || maxSvgY - minSvgY < 8) {
      return;
    }

    const currentDomain = zoomDomain ?? displayBounds;
    const lowerLeft = chartDataPointFromSvgPosition(
      { x: minSvgX, y: maxSvgY },
      currentDomain,
    );
    const upperRight = chartDataPointFromSvgPosition(
      { x: maxSvgX, y: minSvgY },
      currentDomain,
    );
    setZoomDomain({
      maxX: upperRight.x,
      maxY: upperRight.y,
      minX: lowerLeft.x,
      minY: lowerLeft.y,
    });
  }

  const selectionRect =
    boxZoomStart && boxZoomCurrent
      ? {
          height: Math.abs(boxZoomCurrent.y - boxZoomStart.y),
          width: Math.abs(boxZoomCurrent.x - boxZoomStart.x),
          x: Math.min(boxZoomStart.x, boxZoomCurrent.x),
          y: Math.min(boxZoomStart.y, boxZoomCurrent.y),
        }
      : null;
  const svgClassName = [
    panStart ? "analysis-chart-panning" : "",
    interactionMode === "boxZoom" ? "analysis-chart-box-zoom-mode" : "",
    boxZoomStart ? "analysis-chart-selecting" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const seriesControls =
    populatedSeries.length > 1 && useSeriesSelect ? (
      <div className="analysis-chart-trace-controls">
        <label className="analysis-chart-series-select">
          <span>Trace</span>
          <select
            aria-label={`${title} trace`}
            data-testid={`${testId}-trace-select`}
            onChange={(event) => focusSeries(event.target.value)}
            value={activeSelectedSeriesKey}
          >
            {populatedSeries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <div className="analysis-chart-trace-actions">
          <button
            data-testid={`${testId}-show-trace`}
            onClick={showFocusedSeries}
            type="button"
          >
            Show
          </button>
          <button
            data-testid={`${testId}-add-trace`}
            onClick={addFocusedSeries}
            type="button"
          >
            Add
          </button>
          <button
            data-testid={`${testId}-all-traces`}
            onClick={showAllTraces}
            type="button"
          >
            All
          </button>
        </div>
        {showAllSeries ? (
          <span className="analysis-chart-trace-summary">All traces</span>
        ) : (
          <div className="analysis-chart-trace-chips">
            {activeComparisonKeys.map((key) => {
              const entry = populatedSeries.find(
                (seriesEntry) => seriesEntry.key === key,
              );
              if (!entry) {
                return null;
              }
              return (
                <button
                  key={key}
                  onClick={() => removeComparisonSeries(key)}
                  title={`Remove ${entry.label}`}
                  type="button"
                >
                  {entry.label}
                  <X size={12} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    ) : null;
  const tooltipSize = { height: 58, width: 172 };
  const tooltipPosition = hoveredPoint
    ? chartTooltipPosition(
        {
          x: xScale(hoveredPoint.point.x),
          y: yScale(hoveredPoint.point.y),
        },
        plot,
        tooltipSize,
      )
    : null;

  return (
    <div className="analysis-chart" data-testid={testId}>
      <div className="analysis-chart-heading">
        <div className="analysis-chart-toolbar">
          <div className="analysis-chart-secondary-controls">
            {valueModeControl}
            <div className="analysis-chart-nav">
              <button
                aria-label={`${title} box zoom`}
                aria-pressed={interactionMode === "boxZoom"}
                data-testid={`${testId}-box-zoom`}
                onClick={() => toggleInteractionMode("boxZoom")}
                title="Drag a region to zoom"
                type="button"
              >
                <BoxSelect size={14} />
              </button>
              <button
                aria-label={`${title} zoom in`}
                data-testid={`${testId}-zoom-in`}
                onClick={() => zoomChart(0.72)}
                type="button"
              >
                <ZoomIn size={14} />
              </button>
              <button
                aria-label={`${title} zoom out`}
                data-testid={`${testId}-zoom-out`}
                onClick={() => zoomChart(1.32)}
                type="button"
              >
                <ZoomOut size={14} />
              </button>
              <button
                aria-label={`${title} reset view`}
                data-testid={`${testId}-reset-view`}
                disabled={!zoomDomain}
                onClick={() => setZoomDomain(null)}
                type="button"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          <div className="analysis-chart-primary-controls">
            {plotSelectorControl}
            <div
              aria-label={`${title} y-axis scale`}
              className="analysis-chart-axis-mode"
              role="group"
            >
              <button
                aria-pressed={effectiveYAxisMode === "auto"}
                data-testid={`${testId}-axis-auto`}
                onClick={() => changeYAxisMode("auto")}
                type="button"
              >
                Auto
              </button>
              <button
                aria-pressed={effectiveYAxisMode === "fixed"}
                data-testid={`${testId}-axis-fixed`}
                disabled={!hasReferenceY}
                onClick={() => changeYAxisMode("fixed")}
                title={
                  hasReferenceY
                    ? "Use cached sweep points for the y-axis"
                    : "Run a sweep to use cached points for the y-axis"
                }
                type="button"
              >
                Fixed
              </button>
              <button
                aria-pressed={effectiveYAxisMode === "manual"}
                data-testid={`${testId}-axis-manual`}
                onClick={() => changeYAxisMode("manual")}
                type="button"
              >
                Manual
              </button>
            </div>
          </div>
          {seriesControls}
        </div>
      </div>
      {effectiveYAxisMode === "manual" ? (
        <div className="analysis-chart-manual-axis">
          <label>
            <span>Y min</span>
            <input
              aria-label={`${title} y min`}
              data-testid={`${testId}-y-min`}
              inputMode="decimal"
              onChange={(event) => updateManualYMin(event.target.value)}
              placeholder="auto"
              value={manualYMinText}
            />
          </label>
          <label>
            <span>Y max</span>
            <input
              aria-label={`${title} y max`}
              data-testid={`${testId}-y-max`}
              inputMode="decimal"
              onChange={(event) => updateManualYMax(event.target.value)}
              placeholder="auto"
              value={manualYMaxText}
            />
          </label>
          {manualAxisMessage ? (
            <span
              className="analysis-chart-axis-warning"
              data-testid={`${testId}-axis-message`}
            >
              {manualAxisMessage}
            </span>
          ) : null}
        </div>
      ) : null}
      <svg
        aria-label={title}
        className={svgClassName || undefined}
        onPointerMove={(event) => {
          if (boxZoomStart) {
            const position = plotPositionFromClient(event.clientX, event.clientY);
            if (position) {
              setBoxZoomCurrent(position);
            }
            return;
          }
          if (!panStart) {
            return;
          }
          const position = svgPositionFromClient(event.clientX, event.clientY);
          if (!position) {
            return;
          }
          const xRange = panStart.domain.maxX - panStart.domain.minX;
          const yRange = panStart.domain.maxY - panStart.domain.minY;
          const dx = ((position.x - panStart.x) / plotWidth) * xRange;
          const dy = ((position.y - panStart.y) / plotHeight) * yRange;
          setZoomDomain({
            maxX: panStart.domain.maxX - dx,
            maxY: panStart.domain.maxY + dy,
            minX: panStart.domain.minX - dx,
            minY: panStart.domain.minY + dy,
          });
        }}
        role="img"
        ref={svgRef}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        onPointerLeave={() => {
          setHoveredPoint(null);
          setPanStart(null);
          setBoxZoomStart(null);
          setBoxZoomCurrent(null);
        }}
        onPointerUp={(event) => {
          if (boxZoomStart) {
            finishBoxZoom(event.clientX, event.clientY);
            return;
          }
          setPanStart(null);
        }}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) {
            return;
          }
          event.preventDefault();
          const position = svgPositionFromClient(event.clientX, event.clientY);
          zoomChart(event.deltaY > 0 ? 1.18 : 0.86, position ?? undefined);
        }}
      >
        <defs>
          <clipPath id={clipPathId}>
            <rect
              x={plot.left}
              y={plot.top}
              width={plotWidth}
              height={plotHeight}
            />
          </clipPath>
        </defs>
        <rect
          className="analysis-chart-plot-bg"
          data-testid={`${testId}-plot-area`}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            const position = plotPositionFromClient(event.clientX, event.clientY);
            if (!position) {
              return;
            }
            setHoveredPoint(null);
            event.currentTarget.setPointerCapture(event.pointerId);
            if (interactionMode === "boxZoom") {
              setBoxZoomStart(position);
              setBoxZoomCurrent(position);
              return;
            }
            setPanStart({
              domain: zoomDomain ?? displayBounds,
              x: position.x,
              y: position.y,
            });
          }}
          x={plot.left}
          y={plot.top}
          width={plotWidth}
          height={plotHeight}
        />
        {selectionRect ? (
          <rect
            className="analysis-chart-selection"
            data-testid={`${testId}-box-selection`}
            height={selectionRect.height}
            width={selectionRect.width}
            x={selectionRect.x}
            y={selectionRect.y}
          />
        ) : null}
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={`y-${tick}`}>
              <line
                className="analysis-chart-grid"
                x1={plot.left}
                x2={plot.right}
                y1={y}
                y2={y}
              />
              <text
                className="analysis-chart-tick"
                data-axis="y"
                textAnchor="end"
                x={plot.left - 8}
                y={y + 4}
              >
                {formatChartTick(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick) => {
          const x = xScale(tick);
          return (
            <g key={`x-${tick}`}>
              <line
                className="analysis-chart-grid"
                x1={x}
                x2={x}
                y1={plot.top}
                y2={plot.bottom}
              />
              <text
                className="analysis-chart-tick"
                data-axis="x"
                textAnchor="middle"
                x={x}
                y={plot.bottom + 18}
              >
                {formatChartTick(tick)}
              </text>
            </g>
          );
        })}
        {zeroLineVisible ? (
          <line
            className="analysis-chart-zero-line"
            data-testid={`${testId}-zero-line`}
            x1={plot.left}
            x2={plot.right}
            y1={yScale(0)}
            y2={yScale(0)}
          />
        ) : null}
        <line
          className="analysis-chart-axis"
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={plot.bottom}
        />
        <line
          className="analysis-chart-axis"
          x1={plot.left}
          x2={plot.right}
          y1={plot.bottom}
          y2={plot.bottom}
        />
        <text
          className="analysis-chart-axis-label"
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={viewHeight - 6}
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
        <g clipPath={`url(#${clipPathId})`}>
          {visibleSeries.map((entry) => {
            const color = chartColor(
              Math.max(
                0,
                populatedSeries.findIndex(
                  (seriesEntry) => seriesEntry.key === entry.key,
                ),
              ),
            );
            const scaledPoints = entry.points.map((point) => ({
              point,
              x: xScale(point.x),
              y: yScale(point.y),
            }));
            return (
              <g key={entry.key}>
                {scaledPoints.length > 1 ? (
                  <path
                    className="analysis-chart-line"
                    d={pointsToPath(scaledPoints)}
                    stroke={color}
                  />
                ) : null}
                {scaledPoints.map(({ point, x, y }, pointIndex) => (
                  <circle
                    key={`${entry.key}-${pointIndex}`}
                    className="analysis-chart-point"
                    cx={x}
                    cy={y}
                    fill={color}
                    onPointerEnter={() =>
                      showPointTooltip(point, entry.label, color)
                    }
                    onPointerMove={() =>
                      showPointTooltip(point, entry.label, color)
                    }
                    r="4"
                  />
                ))}
              </g>
            );
          })}
        </g>
        <g className="analysis-chart-hit-targets">
          {visibleSeries.map((entry) => {
            const color = chartColor(
              Math.max(
                0,
                populatedSeries.findIndex(
                  (seriesEntry) => seriesEntry.key === entry.key,
                ),
              ),
            );
            return entry.points.map((point, pointIndex) => {
              const x = xScale(point.x);
              const y = yScale(point.y);
              if (
                x < plot.left ||
                x > plot.right ||
                y < plot.top ||
                y > plot.bottom
              ) {
                return null;
              }
              return (
                <circle
                  key={`${entry.key}-${pointIndex}-hit-target`}
                  className="analysis-chart-hit-target"
                  cx={x}
                  cy={y}
                  onPointerEnter={() =>
                    showPointTooltip(point, entry.label, color)
                  }
                  onPointerMove={() =>
                    showPointTooltip(point, entry.label, color)
                  }
                  r="10"
                />
              );
            });
          })}
        </g>
        {hoveredPoint && tooltipPosition ? (
          <g
            className="analysis-chart-tooltip"
            data-testid={`${testId}-tooltip`}
            transform={`translate(${tooltipPosition.x} ${tooltipPosition.y})`}
          >
            <rect width={tooltipSize.width} height={tooltipSize.height} rx="6" />
            <circle cx="12" cy="16" fill={hoveredPoint.color} r="4" />
            <text x="22" y="20">
              {hoveredPoint.seriesLabel}
            </text>
            <text x="10" y="38">
              {xLabel}: {formatChartTick(hoveredPoint.point.x)}
            </text>
            <text x="10" y="52">
              {yLabel}: {formatModalNumber(hoveredPoint.point.y)}
            </text>
          </g>
        ) : null}
      </svg>
      {populatedSeries.length > 1 ? (
        useSeriesSelect ? null : (
          <div className="analysis-chart-legend">
            {populatedSeries.map((entry, index) => {
              const hidden = hiddenKeys.has(entry.key);
              return (
                <button
                  key={entry.key}
                  aria-pressed={!hidden}
                  className={hidden ? "muted" : ""}
                  onClick={() => toggleSeries(entry.key)}
                  type="button"
                >
                  <span
                    className="analysis-chart-swatch"
                    style={{ backgroundColor: chartColor(index) }}
                  />
                  {entry.label}
                </button>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
