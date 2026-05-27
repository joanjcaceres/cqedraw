import { useEffect, useMemo, useRef, useState } from "react";

import { emptyProject } from "./graph";
import {
  PROJECT_HISTORY_LIMIT,
  appendProjectHistoryEntry,
  projectsMatch,
  serializeProjectForDirtyCheck,
  type ProjectHistory,
} from "./projectState";
import type { CircuitProject } from "./types";

interface UseProjectHistoryOptions {
  onProjectRestored: (message: string) => void;
  onProjectStatus: (message: string) => void;
}

const EMPTY_PROJECT_HISTORY: ProjectHistory = {
  past: [],
  future: [],
};

export function useProjectHistory({
  onProjectRestored,
  onProjectStatus,
}: UseProjectHistoryOptions) {
  const [project, setProject] = useState<CircuitProject>(() => emptyProject());
  const [cleanProjectSnapshot, setCleanProjectSnapshot] = useState(() =>
    serializeProjectForDirtyCheck(emptyProject()),
  );
  const [projectHistory, setProjectHistory] =
    useState<ProjectHistory>(EMPTY_PROJECT_HISTORY);
  const projectRef = useRef<CircuitProject>(project);
  const projectHistoryRef = useRef<ProjectHistory>(projectHistory);

  const currentProjectSnapshot = useMemo(
    () => serializeProjectForDirtyCheck(project),
    [project],
  );
  const hasUnsavedChanges = currentProjectSnapshot !== cleanProjectSnapshot;
  const canUndo = projectHistory.past.length > 0;
  const canRedo = projectHistory.future.length > 0;

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function setProjectState(nextProject: CircuitProject) {
    projectRef.current = nextProject;
    setProject(nextProject);
  }

  function updateProjectState(
    updateProject: (current: CircuitProject) => CircuitProject,
  ) {
    setProjectState(updateProject(projectRef.current));
  }

  function setProjectHistoryState(nextHistory: ProjectHistory) {
    projectHistoryRef.current = nextHistory;
    setProjectHistory(nextHistory);
  }

  function resetProjectHistory() {
    setProjectHistoryState(EMPTY_PROJECT_HISTORY);
  }

  function markProjectClean(nextProject = projectRef.current) {
    setCleanProjectSnapshot(serializeProjectForDirtyCheck(nextProject));
  }

  function recordProjectHistory(previousProject: CircuitProject) {
    const history = projectHistoryRef.current;
    setProjectHistoryState({
      past: appendProjectHistoryEntry(history.past, previousProject),
      future: [],
    });
  }

  function commitProjectChange(
    updateProject: (current: CircuitProject) => CircuitProject,
  ) {
    const currentProject = projectRef.current;
    const next = updateProject(currentProject);
    if (projectsMatch(currentProject, next)) {
      return;
    }
    recordProjectHistory(currentProject);
    setProjectState(next);
  }

  function restoreProjectFromHistory(nextProject: CircuitProject, message: string) {
    setProjectState(nextProject);
    onProjectRestored(message);
  }

  function undoProjectChange() {
    const history = projectHistoryRef.current;
    if (history.past.length === 0) {
      onProjectStatus("Nothing to undo.");
      return;
    }

    const currentProject = projectRef.current;
    const previous = history.past[history.past.length - 1];
    setProjectHistoryState({
      past: history.past.slice(0, -1),
      future: [currentProject, ...history.future].slice(0, PROJECT_HISTORY_LIMIT),
    });
    restoreProjectFromHistory(previous, "Undid last change.");
  }

  function redoProjectChange() {
    const history = projectHistoryRef.current;
    if (history.future.length === 0) {
      onProjectStatus("Nothing to redo.");
      return;
    }

    const currentProject = projectRef.current;
    const next = history.future[0];
    setProjectHistoryState({
      past: appendProjectHistoryEntry(history.past, currentProject),
      future: history.future.slice(1),
    });
    restoreProjectFromHistory(next, "Redid last change.");
  }

  return {
    canRedo,
    canUndo,
    commitProjectChange,
    hasUnsavedChanges,
    markProjectClean,
    project,
    projectRef,
    recordProjectHistory,
    redoProjectChange,
    resetProjectHistory,
    setProjectState,
    undoProjectChange,
    updateProjectState,
  };
}
