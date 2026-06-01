import {
  ClipboardCopy,
  ClipboardPaste,
  BoxSelect,
  Circle,
  CircleHelp,
  Download,
  SquarePlus,
  GitBranch,
  Merge,
  Menu,
  MousePointer2,
  Redo2,
  Repeat2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type { ChangeEvent, ReactNode, Ref, RefObject } from "react";

import type { ToolMode } from "./types";
import type { TutorialStep } from "./tutorialFlow";

export function AppToolbar({
  canRedo,
  canStartNewProject,
  canUndo,
  concatenateButtonRef,
  fileInputRef,
  hasUnsavedChanges,
  helpButtonRef,
  mode,
  newProjectButtonRef,
  nodeButtonRef,
  onCopySelection,
  onDeleteSelection,
  onHelpOpen,
  onLoadProject,
  onMergeSelectedNodes,
  onNewProject,
  onOpenConcatenateDialog,
  onOutputToggle,
  onPaste,
  onRedo,
  onSaveProject,
  onSetMode,
  onUndo,
  outputDrawerOpen,
  selectedNodeCount,
  tutorialStep,
}: {
  canRedo: boolean;
  canStartNewProject: boolean;
  canUndo: boolean;
  concatenateButtonRef: Ref<HTMLButtonElement>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  hasUnsavedChanges: boolean;
  helpButtonRef: Ref<HTMLButtonElement>;
  mode: ToolMode;
  newProjectButtonRef: Ref<HTMLButtonElement>;
  nodeButtonRef: Ref<HTMLButtonElement>;
  onCopySelection: () => void;
  onDeleteSelection: () => void;
  onHelpOpen: () => void;
  onLoadProject: (file: File) => void;
  onMergeSelectedNodes: () => void;
  onNewProject: () => void;
  onOpenConcatenateDialog: () => void;
  onOutputToggle: () => void;
  onPaste: () => void;
  onRedo: () => void;
  onSaveProject: () => void;
  onSetMode: (mode: ToolMode) => void;
  onUndo: () => void;
  outputDrawerOpen: boolean;
  selectedNodeCount: number;
  tutorialStep: TutorialStep | null;
}) {
  function handleProjectFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) {
      onLoadProject(file);
    }
    event.currentTarget.value = "";
  }

  return (
    <header className="topbar">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" />
        <div>
          <strong>cQEDraw</strong>
          <span>Web</span>
        </div>
      </div>
      <div className="toolbar" aria-label="Tools">
        <ToolButton
          active={mode === "select"}
          icon={<MousePointer2 size={17} />}
          label="Select"
          shortcut="V"
          onClick={() => onSetMode("select")}
        />
        <ToolButton
          active={mode === "box-select"}
          icon={<BoxSelect size={17} />}
          label="Box Select"
          shortcut="B"
          onClick={() => onSetMode("box-select")}
        />
        <ToolButton
          active={mode === "node"}
          buttonRef={nodeButtonRef}
          highlight={tutorialStep === "first-node" || tutorialStep === "second-node"}
          icon={<Circle size={17} />}
          label="Node"
          shortcut="N"
          onClick={() => onSetMode("node")}
        />
        <ToolButton
          active={mode === "edge"}
          highlight={tutorialStep === "edge-mode"}
          icon={<GitBranch size={17} />}
          label="Edge"
          shortcut="E"
          onClick={() => onSetMode("edge")}
        />
        <ToolButton
          active={mode === "ground"}
          highlight={tutorialStep === "ground-mode"}
          icon={<GroundIcon size={17} />}
          label="Ground"
          shortcut="G"
          onClick={() => onSetMode("ground")}
        />
        <ToolButton
          disabled={selectedNodeCount < 2}
          icon={<Merge size={17} />}
          label="Merge"
          shortcut="M"
          onClick={onMergeSelectedNodes}
        />
        <ToolButton
          icon={<ClipboardCopy size={17} />}
          label="Copy Selection"
          shortcut="Ctrl/Cmd+C"
          onClick={onCopySelection}
        />
        <ToolButton
          icon={<ClipboardPaste size={17} />}
          label="Paste"
          shortcut="Ctrl/Cmd+V"
          onClick={onPaste}
        />
        <ToolButton
          buttonRef={concatenateButtonRef}
          disabled={selectedNodeCount === 0}
          icon={<Repeat2 size={17} />}
          label="Concatenate"
          shortcut="D"
          onClick={onOpenConcatenateDialog}
        />
        <ToolButton
          icon={<Trash2 size={17} />}
          label="Delete"
          shortcut="Del/Backspace"
          onClick={onDeleteSelection}
        />
        <ToolButton
          disabled={!canUndo}
          icon={<Undo2 size={17} />}
          label="Undo"
          shortcut="Ctrl/Cmd+Z"
          onClick={onUndo}
        />
        <ToolButton
          disabled={!canRedo}
          icon={<Redo2 size={17} />}
          label="Redo"
          shortcut="Ctrl/Cmd+Y"
          onClick={onRedo}
        />
      </div>
      <div className="toolbar actions" aria-label="Project actions">
        <ToolButton
          buttonRef={newProjectButtonRef}
          disabled={!canStartNewProject}
          icon={<SquarePlus size={17} />}
          label="New project"
          onClick={onNewProject}
        />
        <ToolButton
          active={outputDrawerOpen}
          highlight={tutorialStep === "generate"}
          icon={<Menu size={17} />}
          iconOnly={false}
          label="Output"
          onClick={onOutputToggle}
        />
        <ToolButton
          icon={<Download size={17} />}
          label="Save"
          shortcut="Ctrl/Cmd+S"
          onClick={onSaveProject}
        />
        <span aria-live="polite" data-testid="save-status">
          {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
        </span>
        <ToolButton
          icon={<Upload size={17} />}
          label="Load"
          shortcut="Ctrl/Cmd+O"
          onClick={() => fileInputRef.current?.click()}
        />
        <ToolButton
          buttonRef={helpButtonRef}
          icon={<CircleHelp size={17} />}
          label="Help"
          onClick={onHelpOpen}
        />
      </div>
      <input
        ref={fileInputRef}
        className="hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={handleProjectFileChange}
      />
    </header>
  );
}

function GroundIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M12 4v7" />
      <path d="M6 11h12" />
      <path d="M8 15h8" />
      <path d="M10 19h4" />
    </svg>
  );
}

function ToolButton({
  active = false,
  buttonRef,
  confirmation,
  disabled = false,
  highlight = false,
  icon,
  iconOnly = true,
  label,
  onClick,
  shortcut,
}: {
  active?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  confirmation?: string;
  disabled?: boolean;
  highlight?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const tooltipLabel = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      aria-label={label}
      className={[
        "tool-button",
        iconOnly ? "tool-button-icon-only" : "tool-button-with-label",
        active ? "active" : "",
        highlight ? "tutorial-highlight" : "",
      ].join(" ")}
      disabled={disabled}
      ref={buttonRef}
      title={tooltipLabel}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className={iconOnly ? "sr-only" : "tool-button-label"}>{label}</span>
      {confirmation ? (
        <span aria-hidden="true" className="tool-button-confirmation">
          {confirmation}
        </span>
      ) : null}
      <span aria-hidden="true" className="tool-button-tooltip">
        {tooltipLabel}
      </span>
    </button>
  );
}
