import { useState, type RefObject } from "react";

import { emptyProject, normalizeProject } from "./graph";
import {
  applyOutputDefaultsToProject,
  EMPTY_OUTPUT_DEFAULTS_SNAPSHOT,
  extractProjectParameterNames,
  outputDefaultsStateFromMetadata,
  readProjectOutputDefaults,
  serializeOutputDefaultsForDirtyCheck,
} from "./outputDefaults";
import type { ParameterInputMode } from "./parameterUnits";
import type { SelectionClipboard } from "./projectState";
import type {
  CircuitProject,
  CircuitProjectOutputDefaults,
  OutputResult,
  ToolMode,
} from "./types";
import type { TutorialStep } from "./tutorialFlow";
import { DEFAULT_VIEW_BOX, fitProjectView, type ViewBox } from "./viewBox";

interface UseProjectLifecycleOptions {
  canStartNewProject: boolean;
  hasProjectContent: boolean;
  hasUnsavedChanges: boolean;
  helpButtonRef: RefObject<HTMLButtonElement | null>;
  markProjectClean: (project?: CircuitProject, dirtySnapshotExtras?: string[]) => void;
  newProjectButtonRef: RefObject<HTMLButtonElement | null>;
  nodeButtonRef: RefObject<HTMLButtonElement | null>;
  outputDefaults: CircuitProjectOutputDefaults | undefined;
  outputDefaultsSnapshot: string;
  project: CircuitProject;
  resetLoadedProjectInteractionState: () => void;
  resetProjectHistory: () => void;
  resetProjectInteractionState: () => void;
  resetTutorialProjectInteractionState: () => void;
  setEngineStatus: (message: string) => void;
  setHelpOpen: (open: boolean) => void;
  setMode: (mode: ToolMode) => void;
  setOutput: (output: OutputResult | null) => void;
  setOutputDrawerOpen: (open: boolean) => void;
  setParameterInputModes: (modes: Record<string, ParameterInputMode>) => void;
  setParameterValues: (values: Record<string, string>) => void;
  setProjectState: (project: CircuitProject) => void;
  setSelectionClipboard: (clipboard: SelectionClipboard | null) => void;
  setTutorialCopied: (copied: boolean) => void;
  setTutorialPromptOpen: (open: boolean) => void;
  setTutorialStep: (step: TutorialStep | null) => void;
  setViewBox: (viewBox: ViewBox) => void;
}

export function useProjectLifecycle({
  canStartNewProject,
  hasProjectContent,
  hasUnsavedChanges,
  helpButtonRef,
  markProjectClean,
  newProjectButtonRef,
  nodeButtonRef,
  outputDefaults,
  outputDefaultsSnapshot,
  project,
  resetLoadedProjectInteractionState,
  resetProjectHistory,
  resetProjectInteractionState,
  resetTutorialProjectInteractionState,
  setEngineStatus,
  setHelpOpen,
  setMode,
  setOutput,
  setOutputDrawerOpen,
  setParameterInputModes,
  setParameterValues,
  setProjectState,
  setSelectionClipboard,
  setTutorialCopied,
  setTutorialPromptOpen,
  setTutorialStep,
  setViewBox,
}: UseProjectLifecycleOptions) {
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [tutorialResetOpen, setTutorialResetOpen] = useState(false);

  function saveProject() {
    const projectForSave = applyOutputDefaultsToProject(project, outputDefaults);
    const blob = new Blob([JSON.stringify(projectForSave, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cqedraw-project.json";
    document.body.append(link);
    link.click();
    link.remove();
    markProjectClean(project, [outputDefaultsSnapshot]);
    setEngineStatus("Project saved.");
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadProject(file: File) {
    const parsed = JSON.parse(await file.text());
    const next = normalizeProject(parsed);
    const parameterNames = extractProjectParameterNames(next);
    const loadedDefaults = readProjectOutputDefaults(parsed, parameterNames);
    const outputDefaultsState = outputDefaultsStateFromMetadata(loadedDefaults);
    const loadedDefaultsSnapshot = serializeOutputDefaultsForDirtyCheck(
      loadedDefaults,
    );
    setProjectState(next);
    resetProjectHistory();
    setParameterValues(outputDefaultsState.parameterValues);
    setParameterInputModes(outputDefaultsState.parameterInputModes);
    markProjectClean(next, [loadedDefaultsSnapshot]);
    setViewBox(fitProjectView(next));
    resetLoadedProjectInteractionState();
    setOutput(null);
    setOutputDrawerOpen(false);
  }

  function resetToNewProject() {
    const next = emptyProject();
    setProjectState(next);
    resetProjectHistory();
    setParameterValues({});
    setParameterInputModes({});
    markProjectClean(next, [EMPTY_OUTPUT_DEFAULTS_SNAPSHOT]);
    setMode("node");
    resetProjectInteractionState();
    setSelectionClipboard(null);
    setViewBox(DEFAULT_VIEW_BOX);
    setOutput(null);
    setOutputDrawerOpen(false);
    setNewProjectDialogOpen(false);
    setTutorialResetOpen(false);
    setTutorialStep(null);
    setTutorialCopied(false);
    setEngineStatus("Started new project.");
  }

  function requestNewProject() {
    if (!canStartNewProject) {
      setEngineStatus("Project is already empty.");
      return;
    }
    if (hasProjectContent || hasUnsavedChanges) {
      setNewProjectDialogOpen(true);
      return;
    }
    resetToNewProject();
  }

  function closeNewProjectDialog() {
    setNewProjectDialogOpen(false);
    window.requestAnimationFrame(() => newProjectButtonRef.current?.focus());
  }

  function confirmNewProject() {
    resetToNewProject();
    window.requestAnimationFrame(() => nodeButtonRef.current?.focus());
  }

  function beginTutorial() {
    const next = emptyProject();
    setProjectState(next);
    resetProjectHistory();
    setParameterValues({});
    setParameterInputModes({});
    markProjectClean(next, [EMPTY_OUTPUT_DEFAULTS_SNAPSHOT]);
    setMode("node");
    resetTutorialProjectInteractionState();
    setViewBox(DEFAULT_VIEW_BOX);
    setOutput(null);
    setOutputDrawerOpen(false);
    setEngineStatus("Ready.");
    setTutorialCopied(false);
    setTutorialPromptOpen(false);
    setTutorialResetOpen(false);
    setTutorialStep("welcome");
  }

  function requestTutorialStart() {
    setHelpOpen(false);
    if (project.state.nodes.length > 0 || project.state.edges.length > 0) {
      setTutorialResetOpen(true);
      return;
    }
    beginTutorial();
  }

  function closeTutorialReset() {
    setTutorialResetOpen(false);
    window.requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  function dismissTutorialReset() {
    setTutorialResetOpen(false);
  }

  function confirmTutorialReset() {
    beginTutorial();
    window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="tutorial-callout"] button')
        ?.focus(),
    );
  }

  return {
    beginTutorial,
    closeNewProjectDialog,
    closeTutorialReset,
    confirmNewProject,
    confirmTutorialReset,
    dismissTutorialReset,
    loadProject,
    newProjectDialogOpen,
    requestNewProject,
    requestTutorialStart,
    saveProject,
    tutorialResetOpen,
  };
}
