import { useEffect, useRef, useState } from "react";

import type { CircuitProject } from "./types";
import {
  DEFAULT_VIEW_BOX,
  WHEEL_DELTA_LIMIT,
  WHEEL_ZOOM_SENSITIVITY,
  clamp,
  fitProjectView,
  normalizeWheelDelta,
  svgPointFromClient,
  zoomViewBox,
  type ViewBox,
} from "./viewBox";

interface UseCanvasViewportOptions {
  onWheelZoomStart: () => void;
  project: CircuitProject;
}

export function useCanvasViewport({
  onWheelZoomStart,
  project,
}: UseCanvasViewportOptions) {
  const [viewBox, setViewBox] = useState<ViewBox>(DEFAULT_VIEW_BOX);
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }

    const handleNativeCanvasWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      const anchor = svgPointFromClient(canvasElement, event.clientX, event.clientY);
      const normalizedDelta = normalizeWheelDelta(event);
      const limitedDelta = clamp(
        normalizedDelta,
        -WHEEL_DELTA_LIMIT,
        WHEEL_DELTA_LIMIT,
      );
      const factor = Math.exp(limitedDelta * WHEEL_ZOOM_SENSITIVITY);
      onWheelZoomStart();
      setViewBox((current) => zoomViewBox(current, factor, anchor));
    };

    canvasElement.addEventListener("wheel", handleNativeCanvasWheel, {
      passive: false,
    });
    return () =>
      canvasElement.removeEventListener("wheel", handleNativeCanvasWheel);
  }, [onWheelZoomStart]);

  function zoomCanvas(factor: number) {
    setViewBox((current) => zoomViewBox(current, factor));
  }

  function fitCanvasView() {
    setViewBox(fitProjectView(project));
  }

  return {
    canvasRef,
    canvasStageRef,
    fitCanvasView,
    setViewBox,
    viewBox,
    zoomCanvas,
  };
}
