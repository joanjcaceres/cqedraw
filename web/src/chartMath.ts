import type { ChartBounds } from "./analysis";
import { clamp } from "./viewBox";

export function parseManualChartYBounds(
  minText: string,
  maxText: string,
): { bounds?: { maxY: number; minY: number }; error: string | null } {
  if (minText.trim() === "" || maxText.trim() === "") {
    return { error: "Enter both y-axis limits." };
  }
  const minY = Number(minText);
  const maxY = Number(maxText);
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { error: "Y-axis limits must be finite numbers." };
  }
  if (maxY <= minY) {
    return { error: "Y max must be greater than y min." };
  }
  return { bounds: { maxY, minY }, error: null };
}

export function zoomChartBounds(
  bounds: ChartBounds,
  center: { x: number; y: number },
  factor: number,
): ChartBounds {
  const nextWidth = (bounds.maxX - bounds.minX) * factor;
  const nextHeight = (bounds.maxY - bounds.minY) * factor;
  const minX = center.x - (center.x - bounds.minX) * factor;
  const minY = center.y - (center.y - bounds.minY) * factor;
  return {
    maxX: minX + nextWidth,
    maxY: minY + nextHeight,
    minX,
    minY,
  };
}

export function chartTooltipPosition(
  point: { x: number; y: number },
  plot: { bottom: number; left: number; right: number; top: number },
  size: { height: number; width: number },
): { x: number; y: number } {
  const margin = 8;
  const offset = 12;
  const xCandidate =
    point.x + offset + size.width <= plot.right - margin
      ? point.x + offset
      : point.x - size.width - offset;
  const yCandidate =
    point.y - size.height - offset >= plot.top + margin
      ? point.y - size.height - offset
      : point.y + offset;
  return {
    x: clamp(xCandidate, plot.left + margin, plot.right - size.width - margin),
    y: clamp(yCandidate, plot.top + margin, plot.bottom - size.height - margin),
  };
}

export function chartTicks(min: number, max: number, count = 5): number[] {
  if (count <= 1 || min === max) {
    return [min];
  }
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) =>
    Number((min + step * index).toPrecision(12)),
  );
}

export function integerChartTicks(min: number, max: number, count = 6): number[] {
  const start = Math.ceil(min);
  const end = Math.floor(max);
  if (end < start) {
    return [Math.round((min + max) / 2)];
  }
  if (end === start) {
    return [start];
  }
  const step = Math.max(1, Math.ceil((end - start) / Math.max(1, count - 1)));
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += step) {
    ticks.push(tick);
  }
  if (ticks[ticks.length - 1] !== end) {
    ticks.push(end);
  }
  return ticks;
}

export function chartColor(index: number): string {
  const colors = [
    "#1167c9",
    "#14746f",
    "#b42318",
    "#9a6700",
    "#7c3aed",
    "#c2410c",
    "#0f766e",
    "#be185d",
  ];
  return colors[index % colors.length];
}

export function pointsToPath(points: { x: number; y: number }[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function formatChartTick(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e6) {
    return String(value);
  }
  const absValue = Math.abs(value);
  if (value === 0) {
    return "0";
  }
  if (absValue < 1e-2 || absValue >= 1e4) {
    return value.toExponential(2);
  }
  return Number(value.toPrecision(4)).toString();
}
