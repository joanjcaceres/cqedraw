import type {
  CircuitEdge,
  CircuitProject,
  OutputResult,
  ToolMode,
} from "./types";

const TUTORIAL_STORAGE_KEY = "cqedraw.tutorial.v1";

export type TutorialStep =
  | "welcome"
  | "first-node"
  | "second-node"
  | "edge-mode"
  | "connect-edge"
  | "edge-values"
  | "ground-mode"
  | "add-ground"
  | "ground-values"
  | "edit-edge"
  | "generate"
  | "copy"
  | "finish";

export type TutorialPlacement = "canvas" | "tools" | "actions" | "inspector";

export const TUTORIAL_STEPS: Record<
  TutorialStep,
  { progress: string; title: string; body: string }
> = {
  welcome: {
    progress: "Tutorial",
    title: "Build a small circuit",
    body:
      "This walkthrough creates two nodes, one edge, one ground reference, " +
      "and a Python snippet. You can skip it anytime.",
  },
  "first-node": {
    progress: "Step 1 of 11",
    title: "Place the first node",
    body: "Use Node mode and click the canvas to place the first circuit node.",
  },
  "second-node": {
    progress: "Step 2 of 11",
    title: "Place the second node",
    body: "Click another point on the canvas to place a second node.",
  },
  "edge-mode": {
    progress: "Step 3 of 11",
    title: "Switch to Edge",
    body: "Click Edge in the toolbar so the next node clicks create a connection.",
  },
  "connect-edge": {
    progress: "Step 4 of 11",
    title: "Connect the nodes",
    body: "Click the first node, then click the second node to create one edge between them.",
  },
  "edge-values": {
    progress: "Step 5 of 11",
    title: "Enter edge values",
    body: "In the value panel next to the edge, enter C for capacitance and L for linear inductance.",
  },
  "ground-mode": {
    progress: "Step 6 of 11",
    title: "Switch to Ground",
    body: "Click Ground in the toolbar to add a reference connection.",
  },
  "add-ground": {
    progress: "Step 7 of 11",
    title: "Add the ground reference",
    body: "Click the second node to attach a ground reference to it.",
  },
  "ground-values": {
    progress: "Step 8 of 11",
    title: "Enter ground capacitance",
    body: "In the value panel next to the ground branch, enter Cg for capacitance and leave L empty.",
  },
  "edit-edge": {
    progress: "Step 9 of 11",
    title: "Edit existing values",
    body: "Click the edge between the two nodes again. Its C and L values reopen beside the edge.",
  },
  generate: {
    progress: "Step 10 of 11",
    title: "Prepare matrices",
    body:
      "Click Output in the toolbar. cQEDraw prepares C and L_inv with the same engine used by the desktop app.",
  },
  copy: {
    progress: "Step 11 of 11",
    title: "Copy matrices",
    body: "Click Copy matrices to place the generated Python matrix snippet on the clipboard.",
  },
  finish: {
    progress: "Done",
    title: "Tutorial complete",
    body: "Use Save and Load in the toolbar to store and reopen cQEDraw JSON projects.",
  },
};

export function nextTutorialStep({
  mode,
  output,
  project,
  selectedEdgeId,
  step,
  tutorialCopied,
}: {
  mode: ToolMode;
  output: OutputResult | null;
  project: CircuitProject;
  selectedEdgeId: number | null;
  step: TutorialStep;
  tutorialCopied: boolean;
}): TutorialStep | null {
  const regularEdge = project.state.edges.find((edge) => !edge.is_ground);
  const groundEdge = project.state.edges.find((edge) => edge.is_ground);

  switch (step) {
    case "first-node":
      return project.state.nodes.length >= 1 ? "second-node" : null;
    case "second-node":
      return project.state.nodes.length >= 2 ? "edge-mode" : null;
    case "edge-mode":
      return mode === "edge" ? "connect-edge" : null;
    case "connect-edge":
      return regularEdge ? "edge-values" : null;
    case "edge-values":
      return hasEdgeValues(regularEdge) ? "ground-mode" : null;
    case "ground-mode":
      return mode === "ground" ? "add-ground" : null;
    case "add-ground":
      return groundEdge ? "ground-values" : null;
    case "ground-values":
      return hasCapacitanceValue(groundEdge) ? "edit-edge" : null;
    case "edit-edge":
      return regularEdge && selectedEdgeId === regularEdge.identifier ? "generate" : null;
    case "generate":
      return output ? "copy" : null;
    case "copy":
      return tutorialCopied ? "finish" : null;
    default:
      return null;
  }
}

export function tutorialPlacement(step: TutorialStep): TutorialPlacement {
  if (step === "edge-mode" || step === "ground-mode") {
    return "tools";
  }
  if (step === "generate") {
    return "actions";
  }
  return "canvas";
}

export function isTutorialDismissed(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function rememberTutorialDismissed() {
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "dismissed");
  } catch {
    // Ignore storage failures; the tutorial remains fully usable in-memory.
  }
}

function hasEdgeValues(edge: CircuitEdge | null | undefined): boolean {
  return Boolean(edge?.capacitance_text?.trim() && edge.inductance_text?.trim());
}

function hasCapacitanceValue(edge: CircuitEdge | null | undefined): boolean {
  return Boolean(edge?.capacitance_text?.trim());
}
