import type { PointerEvent } from "react";

import {
  CAPACITOR_SYMBOL_HALF_LENGTH,
  INDUCTOR_SYMBOL_HALF_LENGTH,
  PARALLEL_LC_SYMBOL_HALF_LENGTH,
  branchOffsets,
  capacitorGeometry,
  compactSymbolHalfLength,
  edgeComponentKind,
  edgeEndpoints,
  edgeGeometry,
  edgeInteractionZone,
  edgeValueLabels,
  groundSymbolRotation,
  inductorGeometry,
  inductorPath,
  parallelBranchOffset,
  parallelCapacitorGeometry,
  parallelComponentBranchOffset,
  parallelComponentsForKind,
  parallelLaneDirection,
  type CapacitorGeometry,
  type EdgeComponentKind,
  type ParallelComponent,
} from "./edgeGeometry";
import type { CircuitEdge, CircuitNode } from "./types";
import type { Point } from "./viewBox";

export function CircuitEdgeShape({
  edge,
  nodes,
  selected,
  onGroundPointerDown,
  onPointerDown,
}: {
  edge: CircuitEdge;
  nodes: CircuitNode[];
  selected: boolean;
  onGroundPointerDown: (
    event: PointerEvent<SVGGElement>,
    edgeId: number,
  ) => void;
  onPointerDown: (event: PointerEvent<SVGElement>, edgeId: number) => void;
}) {
  const endpoints = edgeEndpoints(edge, nodes);
  if (!endpoints) {
    return null;
  }

  const { end, start } = endpoints;
  const componentKind = edgeComponentKind(edge);
  const valueLabels = edgeValueLabels(edge, start, end, componentKind);
  const interactionZone = edgeInteractionZone(start, end, componentKind, valueLabels);
  const geometry = edgeGeometry(start, end);

  return (
    <g>
      {interactionZone ? (
        <rect
          className="edge-component-hit-target"
          data-testid={`edge-component-hit-target-${edge.identifier}`}
          height={interactionZone.height}
          transform={`translate(${geometry.center.x} ${geometry.center.y}) rotate(${geometry.angle})`}
          width={interactionZone.width}
          x={interactionZone.x}
          y={interactionZone.y}
          onPointerDown={(event) => onPointerDown(event, edge.identifier)}
        />
      ) : null}
      <line
        data-testid={`edge-${edge.identifier}`}
        className="edge-hit-target"
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        onPointerDown={(event) => onPointerDown(event, edge.identifier)}
      />
      {componentKind === "none" ? (
        <line
          className={selected ? "edge-line selected" : "edge-line"}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
        />
      ) : (
        <EdgeComponentSymbol
          edgeId={edge.identifier}
          kind={componentKind}
          selected={selected}
          start={start}
          end={end}
        />
      )}
      {edge.is_ground ? (
        <GroundSymbol
          edgeId={edge.identifier}
          onPointerDown={onGroundPointerDown}
          rotation={groundSymbolRotation(start, end)}
          selected={selected}
          x={end.x}
          y={end.y}
        />
      ) : null}
      {valueLabels.map((valueLabel) => (
        <text
          key={valueLabel.testId}
          className="edge-label"
          data-testid={valueLabel.testId}
          textAnchor="middle"
          x={valueLabel.point.x}
          y={valueLabel.point.y}
        >
          {valueLabel.text}
        </text>
      ))}
    </g>
  );
}

function EdgeComponentSymbol({
  edgeId,
  end,
  kind,
  selected,
  start,
}: {
  edgeId: number;
  end: Point;
  kind: Exclude<EdgeComponentKind, "none">;
  selected: boolean;
  start: Point;
}) {
  const geometry = edgeGeometry(start, end);
  if (geometry.length === 0) {
    return null;
  }

  return (
    <g
      className={selected ? "edge-component-symbol selected" : "edge-component-symbol"}
      data-component-kind={kind}
      data-testid={`edge-symbol-${edgeId}`}
      transform={`translate(${geometry.center.x} ${geometry.center.y}) rotate(${geometry.angle})`}
    >
      {kind === "capacitor" ? (
        <CapacitorSymbol halfLength={geometry.length / 2} />
      ) : null}
      {kind === "inductor" ? (
        <InductorSymbol halfLength={geometry.length / 2} />
      ) : null}
      {kind === "josephson" ? (
        <JosephsonSymbol halfLength={geometry.length / 2} />
      ) : null}
      {kind === "parallel-lc" ? (
        <ParallelLcSymbol
          halfLength={geometry.length / 2}
          laneDirection={parallelLaneDirection(geometry.angle)}
        />
      ) : null}
      {kind === "parallel-cj" ||
      kind === "parallel-lj" ||
      kind === "parallel-lcj" ? (
        <ParallelComponentSymbol
          components={parallelComponentsForKind(kind)}
          halfLength={geometry.length / 2}
          laneDirection={parallelLaneDirection(geometry.angle)}
        />
      ) : null}
    </g>
  );
}

function CapacitorSymbol({ halfLength }: { halfLength: number }) {
  const symbolHalf = compactSymbolHalfLength(
    halfLength,
    CAPACITOR_SYMBOL_HALF_LENGTH,
  );
  const capacitor = capacitorGeometry(symbolHalf);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-capacitor.plateX} y2={0} />
      <line x1={capacitor.plateX} y1={0} x2={halfLength} y2={0} />
      <CapacitorPlates centerY={0} geometry={capacitor} />
    </>
  );
}

function InductorSymbol({ halfLength }: { halfLength: number }) {
  const coil = inductorGeometry(halfLength, INDUCTOR_SYMBOL_HALF_LENGTH);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-coil.half} y2={0} />
      <path
        data-component-part="inductor-coil"
        d={inductorPath(-coil.half, coil.half, 0, coil.radius)}
      />
      <line x1={coil.half} y1={0} x2={halfLength} y2={0} />
    </>
  );
}

function JosephsonSymbol({ halfLength }: { halfLength: number }) {
  const armHalf = Math.min(compactSymbolHalfLength(halfLength, 16), 12);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={halfLength} y2={0} />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={-armHalf}
        x2={armHalf}
        y2={armHalf}
      />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={armHalf}
        x2={armHalf}
        y2={-armHalf}
      />
    </>
  );
}

function ParallelLcSymbol({
  halfLength,
  laneDirection,
}: {
  halfLength: number;
  laneDirection: number;
}) {
  const junctionX = compactSymbolHalfLength(
    halfLength,
    PARALLEL_LC_SYMBOL_HALF_LENGTH,
  );
  const capacitor = capacitorGeometry(
    Math.min(
      junctionX,
      compactSymbolHalfLength(halfLength, CAPACITOR_SYMBOL_HALF_LENGTH),
    ),
  );
  const coil = inductorGeometry(junctionX, junctionX * 0.72, 10);
  const branchY = parallelBranchOffset(halfLength, capacitor, coil.radius);
  const capacitorY = -branchY * laneDirection;
  const inductorY = branchY * laneDirection;
  const firstY = Math.min(capacitorY, inductorY);
  const lastY = Math.max(capacitorY, inductorY);

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-junctionX} y2={0} />
      <line x1={junctionX} y1={0} x2={halfLength} y2={0} />
      <line x1={-junctionX} y1={firstY} x2={-junctionX} y2={lastY} />
      <line x1={junctionX} y1={firstY} x2={junctionX} y2={lastY} />

      <line x1={-junctionX} y1={capacitorY} x2={-capacitor.plateX} y2={capacitorY} />
      <line x1={capacitor.plateX} y1={capacitorY} x2={junctionX} y2={capacitorY} />
      <CapacitorPlates centerY={capacitorY} geometry={capacitor} />

      <line x1={-junctionX} y1={inductorY} x2={-coil.half} y2={inductorY} />
      <path
        data-component-part="inductor-coil"
        d={inductorPath(-coil.half, coil.half, inductorY, coil.radius)}
      />
      <line x1={coil.half} y1={inductorY} x2={junctionX} y2={inductorY} />
    </>
  );
}

function ParallelComponentSymbol({
  components,
  halfLength,
  laneDirection,
}: {
  components: ParallelComponent[];
  halfLength: number;
  laneDirection: number;
}) {
  const junctionX = compactSymbolHalfLength(
    halfLength,
    PARALLEL_LC_SYMBOL_HALF_LENGTH,
  );
  const branchY = parallelComponentBranchOffset(halfLength, components.length);
  const branchYs = branchOffsets(components.length, branchY).map(
    (offset) => offset * laneDirection,
  );
  const firstY = branchYs[0] ?? 0;
  const lastY = branchYs[branchYs.length - 1] ?? 0;

  return (
    <>
      <line x1={-halfLength} y1={0} x2={-junctionX} y2={0} />
      <line x1={junctionX} y1={0} x2={halfLength} y2={0} />
      <line x1={-junctionX} y1={firstY} x2={-junctionX} y2={lastY} />
      <line x1={junctionX} y1={firstY} x2={junctionX} y2={lastY} />
      {components.map((component, index) => (
        <ParallelComponentBranch
          component={component}
          key={component}
          junctionX={junctionX}
          y={branchYs[index] ?? 0}
        />
      ))}
    </>
  );
}

function ParallelComponentBranch({
  component,
  junctionX,
  y,
}: {
  component: ParallelComponent;
  junctionX: number;
  y: number;
}) {
  if (component === "capacitor") {
    const capacitor = parallelCapacitorGeometry(junctionX);
    return (
      <>
        <line x1={-junctionX} y1={y} x2={-capacitor.plateX} y2={y} />
        <line x1={capacitor.plateX} y1={y} x2={junctionX} y2={y} />
        <CapacitorPlates centerY={y} geometry={capacitor} />
      </>
    );
  }

  if (component === "inductor") {
    const coil = inductorGeometry(junctionX, junctionX * 0.62, 8);
    return (
      <>
        <line x1={-junctionX} y1={y} x2={-coil.half} y2={y} />
        <path
          data-component-part="inductor-coil"
          d={inductorPath(-coil.half, coil.half, y, coil.radius)}
        />
        <line x1={coil.half} y1={y} x2={junctionX} y2={y} />
      </>
    );
  }

  const armHalf = Math.min(compactSymbolHalfLength(junctionX, 14), 10);
  return (
    <>
      <line x1={-junctionX} y1={y} x2={junctionX} y2={y} />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={y - armHalf}
        x2={armHalf}
        y2={y + armHalf}
      />
      <line
        className="component-josephson"
        x1={-armHalf}
        y1={y + armHalf}
        x2={armHalf}
        y2={y - armHalf}
      />
    </>
  );
}

function CapacitorPlates({
  centerY,
  geometry,
}: {
  centerY: number;
  geometry: CapacitorGeometry;
}) {
  const y1 = centerY - geometry.plateHeight / 2;
  const y2 = centerY + geometry.plateHeight / 2;
  return (
    <>
      <line
        className="component-plate"
        data-component-part="capacitor-plate"
        x1={-geometry.plateX}
        y1={y1}
        x2={-geometry.plateX}
        y2={y2}
      />
      <line
        className="component-plate"
        data-component-part="capacitor-plate"
        x1={geometry.plateX}
        y1={y1}
        x2={geometry.plateX}
        y2={y2}
      />
    </>
  );
}

function GroundSymbol({
  edgeId,
  onPointerDown,
  rotation,
  selected,
  x,
  y,
}: {
  edgeId: number;
  onPointerDown: (event: PointerEvent<SVGGElement>, edgeId: number) => void;
  rotation: number;
  selected: boolean;
  x: number;
  y: number;
}) {
  return (
    <g
      className={selected ? "ground-symbol selected" : "ground-symbol"}
      data-testid={`ground-symbol-${edgeId}`}
      onPointerDown={(event) => onPointerDown(event, edgeId)}
      transform={`translate(${x} ${y}) rotate(${rotation})`}
    >
      <circle className="ground-symbol-hit-target" cx={0} cy={10} r={28} />
      <line x1={-18} y1={0} x2={18} y2={0} />
      <line x1={-12} y1={10} x2={12} y2={10} />
      <line x1={-6} y1={20} x2={6} y2={20} />
    </g>
  );
}
