import type { PointerEvent } from "react";

import type { CircuitNode, CircuitProject } from "./types";

export const CANVAS_WIDTH = 900;
export const CANVAS_HEIGHT = 620;
export const NODE_RADIUS = 11;
export const GRID_TILE_SIZE = 24;
export const ZOOM_IN_FACTOR = 0.8;
export const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;
export const WHEEL_ZOOM_SENSITIVITY = 0.001;
export const WHEEL_DELTA_LIMIT = 600;

const GRID_VIEW_MARGIN = GRID_TILE_SIZE * 2;
const MIN_VIEW_WIDTH = CANVAS_WIDTH / 4;
const MAX_VIEW_WIDTH = CANVAS_WIDTH * 20;
const FIT_VIEW_MARGIN = 96;
const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface NodeDragPosition {
  identifier: number;
  x: number;
  y: number;
}

export const DEFAULT_VIEW_BOX: ViewBox = {
  x: 0,
  y: 0,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
};

export function svgPoint(event: PointerEvent<SVGSVGElement>): Point {
  return svgPointFromClient(event.currentTarget, event.clientX, event.clientY);
}

export function svgPointFromClient(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

export function viewBoxToString(viewBox: ViewBox): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

export function gridRectForView(viewBox: ViewBox): ViewBox {
  return {
    x: viewBox.x - GRID_VIEW_MARGIN,
    y: viewBox.y - GRID_VIEW_MARGIN,
    width: viewBox.width + GRID_VIEW_MARGIN * 2,
    height: viewBox.height + GRID_VIEW_MARGIN * 2,
  };
}

export function clampNodeDragDeltaToView(
  nodePositions: NodeDragPosition[],
  deltaX: number,
  deltaY: number,
  viewBox: ViewBox,
): Point {
  if (nodePositions.length === 0) {
    return { x: deltaX, y: deltaY };
  }

  const inset = NODE_RADIUS + 4;
  const minX = Math.min(...nodePositions.map((node) => node.x));
  const maxX = Math.max(...nodePositions.map((node) => node.x));
  const minY = Math.min(...nodePositions.map((node) => node.y));
  const maxY = Math.max(...nodePositions.map((node) => node.y));
  return {
    x: clamp(
      deltaX,
      viewBox.x + inset - minX,
      viewBox.x + viewBox.width - inset - maxX,
    ),
    y: clamp(
      deltaY,
      viewBox.y + inset - minY,
      viewBox.y + viewBox.height - inset - maxY,
    ),
  };
}

export function moveDraggedNodes(
  project: CircuitProject,
  nodePositions: NodeDragPosition[],
  deltaX: number,
  deltaY: number,
): CircuitProject {
  const positionsById = new Map(
    nodePositions.map((node) => [node.identifier, node]),
  );
  return {
    ...project,
    state: {
      ...project.state,
      nodes: project.state.nodes.map((node) => {
        const start = positionsById.get(node.identifier);
        return start
          ? { ...node, x: start.x + deltaX, y: start.y + deltaY }
          : node;
      }),
    },
  };
}

export function rectFromPoints(start: Point, end: Point): ViewBox {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(start.x, end.x) - x,
    height: Math.max(start.y, end.y) - y,
  };
}

export function nodeIdsInsideRect(nodes: CircuitNode[], rect: ViewBox): number[] {
  return nodes
    .filter(
      (node) =>
        node.x >= rect.x &&
        node.x <= rect.x + rect.width &&
        node.y >= rect.y &&
        node.y <= rect.y + rect.height,
    )
    .map((node) => node.identifier);
}

export function zoomViewBox(
  viewBox: ViewBox,
  factor: number,
  anchor: Point = {
    x: viewBox.x + viewBox.width / 2,
    y: viewBox.y + viewBox.height / 2,
  },
): ViewBox {
  const nextWidth = clamp(viewBox.width * factor, MIN_VIEW_WIDTH, MAX_VIEW_WIDTH);
  const nextHeight = nextWidth * (CANVAS_HEIGHT / CANVAS_WIDTH);
  const actualFactor = nextWidth / viewBox.width;
  return {
    x: anchor.x - (anchor.x - viewBox.x) * actualFactor,
    y: anchor.y - (anchor.y - viewBox.y) * actualFactor,
    width: nextWidth,
    height: nextHeight,
  };
}

export function normalizeWheelDelta(
  event: Pick<globalThis.WheelEvent, "deltaMode" | "deltaY">,
): number {
  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    return event.deltaY * CANVAS_HEIGHT;
  }
  return event.deltaY;
}

export function fitProjectView(project: CircuitProject): ViewBox {
  const points = project.state.nodes.map((node) => ({ x: node.x, y: node.y }));
  for (const edge of project.state.edges) {
    if (!edge.is_ground) {
      continue;
    }
    const node = project.state.nodes.find(
      (candidate) => candidate.identifier === edge.nodes[0],
    );
    if (node) {
      points.push({
        x: node.x + edge.ground_offset_x,
        y: node.y + edge.ground_offset_y,
      });
    }
  }

  if (points.length === 0) {
    return DEFAULT_VIEW_BOX;
  }

  const minX = Math.min(...points.map((point) => point.x)) - FIT_VIEW_MARGIN;
  const maxX = Math.max(...points.map((point) => point.x)) + FIT_VIEW_MARGIN;
  const minY = Math.min(...points.map((point) => point.y)) - FIT_VIEW_MARGIN;
  const maxY = Math.max(...points.map((point) => point.y)) + FIT_VIEW_MARGIN;
  const contentWidth = Math.max(maxX - minX, CANVAS_WIDTH);
  const contentHeight = Math.max(maxY - minY, CANVAS_HEIGHT);
  const canvasRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
  const contentRatio = contentWidth / contentHeight;
  let width = contentWidth;
  let height = contentHeight;

  if (contentRatio > canvasRatio) {
    height = width / canvasRatio;
  } else {
    width = height * canvasRatio;
  }

  width = Math.min(width, MAX_VIEW_WIDTH);
  height = width * (CANVAS_HEIGHT / CANVAS_WIDTH);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
