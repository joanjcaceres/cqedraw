import {
  GROUND_NODE_ID,
  type CircuitEdge,
  type CircuitNode,
} from "./types";
import { NODE_RADIUS, clamp, type Point } from "./viewBox";

export const CAPACITOR_SYMBOL_HALF_LENGTH = 22;
export const INDUCTOR_SYMBOL_HALF_LENGTH = 42;
export const PARALLEL_LC_SYMBOL_HALF_LENGTH = 44;

const INLINE_EDGE_EDITOR_OFFSET = 62;
const INLINE_GROUND_EDITOR_OFFSET = 126;
const INLINE_EDITOR_ABOVE_THRESHOLD_PX = 96;

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export type EdgeComponentKind =
  | "none"
  | "capacitor"
  | "inductor"
  | "josephson"
  | "parallel-lc"
  | "parallel-cj"
  | "parallel-lj"
  | "parallel-lcj";

export type ParallelComponent = "capacitor" | "inductor" | "josephson";
type InlineEdgeEditorPlacement = "above" | "below";

export interface InlineEdgeEditorPosition {
  leftPx: number;
  placement: InlineEdgeEditorPlacement;
  topPx: number;
}

export interface EdgeValueLabel {
  point: Point;
  testId: string;
  text: string;
}

export interface EdgeInteractionZone {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CapacitorGeometry {
  plateX: number;
  plateHeight: number;
}

export function capacitorGeometry(symbolHalf: number): CapacitorGeometry {
  return {
    plateX: clampedSymbolInset(symbolHalf * 0.36, symbolHalf, 3),
    plateHeight: clamp(symbolHalf * 1.35, Math.min(10, symbolHalf), 34),
  };
}

export function parallelCapacitorGeometry(
  junctionX: number,
): CapacitorGeometry {
  const capacitor = capacitorGeometry(
    Math.min(
      junctionX,
      compactSymbolHalfLength(junctionX, CAPACITOR_SYMBOL_HALF_LENGTH),
    ),
  );
  return {
    ...capacitor,
    plateHeight: clamp(capacitor.plateHeight, 8, 26),
  };
}

export function inductorGeometry(
  halfLength: number,
  preferredHalf: number,
  maxRadius = 14,
) {
  const coilHalf = compactSymbolHalfLength(halfLength, preferredHalf);
  return {
    half: coilHalf,
    radius: clamp(coilHalf * 0.34, Math.min(4, coilHalf * 0.5), maxRadius),
  };
}

export function parallelBranchOffset(
  halfLength: number,
  capacitor: CapacitorGeometry,
  coilRadius: number,
): number {
  const maxBranchY = Math.max(
    1,
    halfLength - Math.max(capacitor.plateHeight / 2, coilRadius),
  );
  const preferredBranchY = Math.min(
    18,
    Math.max(capacitor.plateHeight / 2 + 8, coilRadius + 8),
  );
  return clamp(preferredBranchY, Math.min(4, maxBranchY), maxBranchY);
}

export function parallelComponentBranchOffset(
  halfLength: number,
  componentCount: number,
): number {
  const maxBranchY = Math.max(1, halfLength - 12);
  const preferredBranchY = componentCount > 2 ? 30 : 24;
  return clamp(preferredBranchY, Math.min(6, maxBranchY), maxBranchY);
}

export function parallelLaneDirection(angle: number): number {
  const radians = (angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  if (Math.abs(sin) > 0.001) {
    return sin < 0 ? 1 : -1;
  }
  return Math.cos(radians) >= 0 ? 1 : -1;
}

export function branchOffsets(componentCount: number, branchY: number): number[] {
  if (componentCount <= 1) {
    return [0];
  }
  if (componentCount === 2) {
    return [-branchY, branchY];
  }
  return [-branchY, 0, branchY];
}

export function parallelComponentsForKind(
  kind: EdgeComponentKind,
): ParallelComponent[] {
  if (kind === "parallel-cj") {
    return ["capacitor", "josephson"];
  }
  if (kind === "parallel-lj") {
    return ["inductor", "josephson"];
  }
  if (kind === "parallel-lcj") {
    return ["capacitor", "inductor", "josephson"];
  }
  return [];
}

export function compactSymbolHalfLength(
  halfLength: number,
  preferred: number,
): number {
  const wireGap = Math.min(10, halfLength * 0.25);
  return Math.min(preferred, Math.max(1, halfLength - wireGap));
}

export function clampedSymbolInset(
  preferred: number,
  halfLength: number,
  minimum: number,
): number {
  const maxInset = Math.max(halfLength - 2, halfLength * 0.5);
  return clamp(preferred, Math.min(minimum, maxInset), maxInset);
}

export function inductorPath(
  startX: number,
  endX: number,
  centerY: number,
  radius: number,
): string {
  const loopCount = 4;
  const loopWidth = (endX - startX) / loopCount;
  const radiusX = loopWidth / 2;
  const segments = [`M ${startX} ${centerY}`];
  for (let index = 0; index < loopCount; index += 1) {
    const x1 = startX + loopWidth * (index + 1);
    segments.push(`A ${radiusX} ${radius} 0 0 1 ${x1} ${centerY}`);
  }
  return segments.join(" ");
}

export function groundSymbolRotation(start: Point, end: Point): number {
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI - 90;
}

export function edgeEndpoints(edge: CircuitEdge, nodes: CircuitNode[]) {
  const first = nodes.find((node) => node.identifier === edge.nodes[0]);
  const second =
    edge.nodes[1] === GROUND_NODE_ID
      ? null
      : nodes.find((node) => node.identifier === edge.nodes[1]);
  if (!first || (!second && !edge.is_ground)) {
    return null;
  }

  return {
    end: {
      x: edge.is_ground ? first.x + edge.ground_offset_x : second!.x,
      y: edge.is_ground ? first.y + edge.ground_offset_y : second!.y,
    },
    start: { x: first.x, y: first.y },
  };
}

export function josephsonPhaseLabel(
  edge: CircuitEdge,
  matrixNodeLabels: Map<number, string>,
): string {
  const first = matrixNodeLabels.get(edge.nodes[0]) ?? String(edge.nodes[0]);
  const second =
    edge.nodes[1] === GROUND_NODE_ID
      ? "GND"
      : matrixNodeLabels.get(edge.nodes[1]) ?? String(edge.nodes[1]);
  const positive =
    edge.josephson_phase_sign === -1
      ? edge.is_ground
        ? "GND"
        : first
      : edge.is_ground
        ? first
        : second;
  const negative =
    edge.josephson_phase_sign === -1
      ? edge.is_ground
        ? first
        : second
      : edge.is_ground
        ? "GND"
        : first;
  return `Phase: ${positive} - ${negative}`;
}

export function matrixNodeLabelMap(nodes: CircuitNode[]): Map<number, string> {
  return new Map(
    [...nodes]
      .sort((first, second) => first.identifier - second.identifier)
      .map((node, index) => [node.identifier, String(index)]),
  );
}

export function inlineEdgeEditorPosition(
  edge: CircuitEdge,
  nodes: CircuitNode[],
  canvas: SVGSVGElement | null,
  stage: HTMLDivElement | null,
): InlineEdgeEditorPosition | null {
  if (!canvas || !stage) {
    return null;
  }
  const endpoints = edgeEndpoints(edge, nodes);
  if (!endpoints) {
    return null;
  }
  const geometry = edgeGeometry(endpoints.start, endpoints.end);
  if (geometry.length === 0) {
    return null;
  }

  const anchor = localEdgePoint(geometry, {
    x: 0,
    y: edge.is_ground
      ? INLINE_GROUND_EDITOR_OFFSET
      : -INLINE_EDGE_EDITOR_OFFSET,
  });
  const matrix = canvas.getScreenCTM();
  if (!matrix) {
    return null;
  }

  const point = canvas.createSVGPoint();
  point.x = anchor.x;
  point.y = anchor.y;
  const screenPoint = point.matrixTransform(matrix);
  const stageRect = stage.getBoundingClientRect();
  const topPx = screenPoint.y - stageRect.top;
  return {
    leftPx: screenPoint.x - stageRect.left,
    placement: topPx < INLINE_EDITOR_ABOVE_THRESHOLD_PX ? "below" : "above",
    topPx,
  };
}

export function edgeComponentKind(edge: CircuitEdge): EdgeComponentKind {
  const hasCapacitance = Boolean(edge.capacitance_text?.trim());
  const hasInductance = Boolean(edge.inductance_text?.trim());
  const hasJosephson = Boolean(edge.josephson_inductance_text?.trim());
  if (hasCapacitance && hasInductance && hasJosephson) {
    return "parallel-lcj";
  }
  if (hasCapacitance && hasInductance) {
    return "parallel-lc";
  }
  if (hasCapacitance && hasJosephson) {
    return "parallel-cj";
  }
  if (hasInductance && hasJosephson) {
    return "parallel-lj";
  }
  if (hasCapacitance) {
    return "capacitor";
  }
  if (hasInductance) {
    return "inductor";
  }
  if (hasJosephson) {
    return "josephson";
  }
  return "none";
}

export function edgeGeometry(start: Point, end: Point) {
  const rawDx = end.x - start.x;
  const rawDy = end.y - start.y;
  const shouldFlipDirection = rawDx < 0 || (Math.abs(rawDx) < 0.001 && rawDy > 0);
  const dx = normalizeZero(shouldFlipDirection ? -rawDx : rawDx);
  const dy = normalizeZero(shouldFlipDirection ? -rawDy : rawDy);
  const length = Math.hypot(dx, dy);
  return {
    angle: normalizeZero((Math.atan2(dy, dx) * 180) / Math.PI),
    center: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    dx,
    dy,
    length,
  };
}

export function edgeValueLabels(
  edge: CircuitEdge,
  start: Point,
  end: Point,
  componentKind: EdgeComponentKind,
): EdgeValueLabel[] {
  const capacitanceText = edge.capacitance_text?.trim();
  const inductanceText = edge.inductance_text?.trim();
  const josephsonInductanceText = edge.josephson_inductance_text?.trim();
  if (componentKind === "none") {
    return [];
  }

  const geometry = edgeGeometry(start, end);
  if (geometry.length === 0) {
    return [];
  }

  if (componentKind === "parallel-lc") {
    const laneDirection = parallelLaneDirection(geometry.angle);
    const capacitorY = -54 * laneDirection;
    const inductorY = 62 * laneDirection;
    return [
      ...(capacitanceText
        ? [
            {
              point: localEdgePoint(geometry, { x: 0, y: capacitorY }),
              testId: `edge-value-cap-${edge.identifier}`,
              text: `C=${capacitanceText}`,
            },
          ]
        : []),
      ...(inductanceText
        ? [
            {
              point: localEdgePoint(geometry, { x: 0, y: inductorY }),
              testId: `edge-value-ind-${edge.identifier}`,
              text: `L=${inductanceText}`,
            },
          ]
        : []),
    ];
  }

  if (
    componentKind === "parallel-cj" ||
    componentKind === "parallel-lj" ||
    componentKind === "parallel-lcj"
  ) {
    const components = parallelComponentsForKind(componentKind);
    const branchY = parallelComponentBranchOffset(geometry.length / 2, components.length);
    const branchYs = branchOffsets(components.length, branchY).map(
      (offset) => offset * parallelLaneDirection(geometry.angle),
    );
    const componentYs = new Map(
      components.map((component, index) => [component, branchYs[index] ?? 0]),
    );
    const symbolHalf = compactSymbolHalfLength(
      geometry.length / 2,
      PARALLEL_LC_SYMBOL_HALF_LENGTH,
    );
    const labelX = Math.min(
      geometry.length / 2 + 18,
      Math.max(56, symbolHalf + 34),
    );
    const labelY = (componentY: number) => componentY + (componentY > 0 ? 18 : -14);
    const labels = [];
    const capacitorY = componentYs.get("capacitor");
    const inductorY = componentYs.get("inductor");
    const josephsonY = componentYs.get("josephson");
    if (capacitanceText) {
      const y = capacitorY ?? -branchY;
      labels.push({
        point: localEdgePoint(geometry, { x: labelX, y: labelY(y) }),
        testId: `edge-value-cap-${edge.identifier}`,
        text: `C=${capacitanceText}`,
      });
    }
    if (inductanceText) {
      const y = inductorY ?? branchY;
      labels.push({
        point: localEdgePoint(geometry, { x: labelX, y: labelY(y) }),
        testId: `edge-value-ind-${edge.identifier}`,
        text: `L=${inductanceText}`,
      });
    }
    if (josephsonInductanceText) {
      const y = josephsonY ?? branchY;
      labels.push({
        point: localEdgePoint(geometry, { x: labelX, y: labelY(y) }),
        testId: `edge-value-jj-${edge.identifier}`,
        text: `LJ=${josephsonInductanceText}`,
      });
    }
    return labels;
  }

  const valueText =
    componentKind === "capacitor"
      ? capacitanceText
      : componentKind === "josephson"
        ? josephsonInductanceText
        : inductanceText;
  if (!valueText) {
    return [];
  }

  return [
    {
      point: localEdgePoint(geometry, { x: 0, y: -44 }),
      testId:
        componentKind === "capacitor"
          ? `edge-value-cap-${edge.identifier}`
          : componentKind === "josephson"
            ? `edge-value-jj-${edge.identifier}`
            : `edge-value-ind-${edge.identifier}`,
      text: `${
        componentKind === "capacitor"
          ? "C"
          : componentKind === "josephson"
            ? "LJ"
            : "L"
      }=${valueText}`,
    },
  ];
}

export function edgeInteractionZone(
  start: Point,
  end: Point,
  componentKind: EdgeComponentKind,
  labels: EdgeValueLabel[],
): EdgeInteractionZone | null {
  if (componentKind === "none") {
    return null;
  }
  const geometry = edgeGeometry(start, end);
  if (geometry.length === 0) {
    return null;
  }

  let minX = -Math.min(64, Math.max(32, geometry.length / 2 - NODE_RADIUS));
  let maxX = Math.min(64, Math.max(32, geometry.length / 2 - NODE_RADIUS));
  let minY = -58;
  let maxY = 58;
  if (
    componentKind === "parallel-lc" ||
    componentKind === "parallel-cj" ||
    componentKind === "parallel-lj" ||
    componentKind === "parallel-lcj"
  ) {
    minY = -86;
    maxY = 92;
  }

  for (const label of labels) {
    const local = globalToLocalEdgePoint(geometry, label.point);
    const halfTextWidth = Math.max(22, label.text.length * 3.9);
    minX = Math.min(minX, local.x - halfTextWidth - 8);
    maxX = Math.max(maxX, local.x + halfTextWidth + 8);
    minY = Math.min(minY, local.y - 18);
    maxY = Math.max(maxY, local.y + 10);
  }

  minX = clamp(minX, -geometry.length / 2 - 22, geometry.length / 2 + 42);
  maxX = clamp(maxX, -geometry.length / 2 - 42, geometry.length / 2 + 96);

  return {
    height: Math.max(28, maxY - minY),
    width: Math.max(28, maxX - minX),
    x: minX,
    y: minY,
  };
}

export function localEdgePoint(
  geometry: ReturnType<typeof edgeGeometry>,
  localPoint: Point,
): Point {
  const angle = (geometry.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: geometry.center.x + localPoint.x * cos - localPoint.y * sin,
    y: geometry.center.y + localPoint.x * sin + localPoint.y * cos,
  };
}

export function globalToLocalEdgePoint(
  geometry: ReturnType<typeof edgeGeometry>,
  point: Point,
): Point {
  const angle = (geometry.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - geometry.center.x;
  const dy = point.y - geometry.center.y;
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}
