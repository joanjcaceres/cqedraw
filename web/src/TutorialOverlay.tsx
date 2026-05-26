import {
  TUTORIAL_STEPS,
  tutorialPlacement,
  type TutorialPlacement,
  type TutorialStep,
} from "./tutorialFlow";

export function TutorialOverlay({
  nodeCount,
  onFinish,
  onNext,
  onSkip,
  onStart,
  promptOpen,
  step,
}: {
  nodeCount: number;
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  onStart: () => void;
  promptOpen: boolean;
  step: TutorialStep | null;
}) {
  return (
    <>
      {promptOpen && step === null && nodeCount === 0 ? (
        <TutorialPrompt onSkip={onSkip} onStart={onStart} />
      ) : null}
      {step ? (
        <TutorialCallout
          step={step}
          placement={tutorialPlacement(step)}
          onFinish={onFinish}
          onNext={onNext}
          onSkip={onSkip}
        />
      ) : null}
    </>
  );
}

function TutorialPrompt({
  onSkip,
  onStart,
}: {
  onSkip: () => void;
  onStart: () => void;
}) {
  return (
    <aside
      aria-label="Tutorial prompt"
      className="tutorial-prompt"
      data-testid="tutorial-prompt"
    >
      <strong>New to cQEDraw?</strong>
      <p>Follow a short tutorial to create a small circuit and copy the matrix snippet.</p>
      <div>
        <button type="button" onClick={onStart}>
          Start tutorial
        </button>
        <button type="button" onClick={onSkip}>
          Skip
        </button>
      </div>
    </aside>
  );
}

function TutorialCallout({
  onFinish,
  onNext,
  onSkip,
  placement,
  step,
}: {
  onFinish: () => void;
  onNext: () => void;
  onSkip: () => void;
  placement: TutorialPlacement;
  step: TutorialStep;
}) {
  const details = TUTORIAL_STEPS[step];
  const isWelcome = step === "welcome";
  const isFinish = step === "finish";

  return (
    <aside
      aria-live="polite"
      className={`tutorial-callout tutorial-callout-${placement}`}
      data-testid="tutorial-callout"
    >
      <span>{details.progress}</span>
      <h2>{details.title}</h2>
      <p>{details.body}</p>
      <div>
        {isWelcome ? (
          <button type="button" onClick={onNext}>
            Start
          </button>
        ) : null}
        {isFinish ? (
          <button type="button" onClick={onFinish}>
            Done
          </button>
        ) : (
          <button type="button" onClick={onSkip}>
            Skip
          </button>
        )}
      </div>
    </aside>
  );
}
