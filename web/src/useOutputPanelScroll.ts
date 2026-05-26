import { useLayoutEffect, useRef, type DependencyList } from "react";

export function useOutputPanelScroll(dependencies: DependencyList) {
  const outputPanelRef = useRef<HTMLElement | null>(null);
  const outputScrollRestoreRef = useRef<{ expiresAt: number; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const restore = outputScrollRestoreRef.current;
    const panel = outputPanelRef.current;
    if (!restore || !panel) {
      return;
    }
    if (performance.now() > restore.expiresAt) {
      outputScrollRestoreRef.current = null;
      return;
    }

    panel.scrollTop = restore.top;
    const animationFrame = window.requestAnimationFrame(() => {
      const activeRestore = outputScrollRestoreRef.current;
      if (!activeRestore || !outputPanelRef.current) {
        return;
      }
      if (performance.now() > activeRestore.expiresAt) {
        outputScrollRestoreRef.current = null;
        return;
      }
      outputPanelRef.current.scrollTop = activeRestore.top;
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, dependencies);

  function preserveOutputPanelScroll() {
    const panel = outputPanelRef.current;
    if (!panel) {
      return;
    }
    outputScrollRestoreRef.current = {
      expiresAt: performance.now() + 2200,
      top: panel.scrollTop,
    };
  }

  return { outputPanelRef, preserveOutputPanelScroll };
}
