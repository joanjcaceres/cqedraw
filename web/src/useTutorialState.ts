import { useEffect, useState, type RefObject } from "react";

import type { CircuitProject, OutputResult, ToolMode } from "./types";
import {
  isTutorialDismissed,
  nextTutorialStep,
  rememberTutorialDismissed,
  type TutorialStep,
} from "./tutorialFlow";

interface UseTutorialStateOptions {
  dismissTutorialResetRef: { current: () => void };
  helpButtonRef: RefObject<HTMLButtonElement | null>;
  mode: ToolMode;
  onPrepareGenerateStep: () => void;
  project: CircuitProject;
  selectedEdgeId: number | null;
  setOutputDrawerOpen: (open: boolean) => void;
  output: OutputResult | null;
}

export function useTutorialState({
  dismissTutorialResetRef,
  helpButtonRef,
  mode,
  onPrepareGenerateStep,
  output,
  project,
  selectedEdgeId,
  setOutputDrawerOpen,
}: UseTutorialStateOptions) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialPromptOpen, setTutorialPromptOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<TutorialStep | null>(null);
  const [tutorialCopied, setTutorialCopied] = useState(false);

  useEffect(() => {
    if (!isTutorialDismissed()) {
      setTutorialPromptOpen(true);
    }
  }, []);

  useEffect(() => {
    if (tutorialStep === "copy") {
      setOutputDrawerOpen(true);
    }
  }, [setOutputDrawerOpen, tutorialStep]);

  useEffect(() => {
    if (project.state.nodes.length > 0 && tutorialPromptOpen && tutorialStep === null) {
      dismissTutorial();
    }
  }, [project.state.nodes.length, tutorialPromptOpen, tutorialStep]);

  useEffect(() => {
    if (tutorialStep === null || tutorialStep === "welcome" || tutorialStep === "finish") {
      return;
    }

    const nextStep = nextTutorialStep({
      step: tutorialStep,
      project,
      mode,
      output,
      selectedEdgeId,
      tutorialCopied,
    });
    if (nextStep === "generate" && mode !== "select") {
      onPrepareGenerateStep();
    }
    if (nextStep === "generate") {
      setOutputDrawerOpen(false);
    }
    if (nextStep && nextStep !== tutorialStep) {
      setTutorialStep(nextStep);
    }
  }, [
    mode,
    onPrepareGenerateStep,
    output,
    project,
    selectedEdgeId,
    setOutputDrawerOpen,
    tutorialCopied,
    tutorialStep,
  ]);

  function closeHelp() {
    setHelpOpen(false);
    window.requestAnimationFrame(() => helpButtonRef.current?.focus());
  }

  function dismissTutorial() {
    rememberTutorialDismissed();
    setTutorialPromptOpen(false);
    setTutorialStep(null);
    dismissTutorialResetRef.current();
  }

  function finishTutorial() {
    rememberTutorialDismissed();
    setTutorialStep(null);
  }

  return {
    closeHelp,
    dismissTutorial,
    finishTutorial,
    helpOpen,
    setHelpOpen,
    setTutorialCopied,
    setTutorialPromptOpen,
    setTutorialStep,
    tutorialCopied,
    tutorialPromptOpen,
    tutorialStep,
  };
}
