import { expect, test } from "./fixtures";
import {
  openOutputDrawer,
  clickBuildMatrices,
  expectRawMatrixEntriesHidden,
  closeOutputDrawer,
  expectBeforeUnloadProtection,
} from "./helpers";

test("guides a first-time web user without blocking drawing", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  const canvasHint = page.getByTestId("canvas-hint");
  await expect(canvasHint).toContainText("Build circuit graphs into matrices");
  await expect(canvasHint).toContainText("Python-ready C and L_inv snippets");
  await expect(canvasHint).toContainText("Explore supported modes");
  await expect(
    canvasHint.getByRole("button", { name: "Start tutorial" }),
  ).toBeVisible();
  await expect(
    canvasHint.getByRole("button", { name: "Load example circuit" }),
  ).toBeVisible();

  await canvasHint.getByRole("button", { name: "Cite and support" }).click();
  const helpDialog = page.getByRole("dialog", { name: "Help" });
  const helpButton = page.getByRole("button", { name: "Help" });
  const closeButton = page.getByRole("button", { name: "Close" });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog).toContainText("What cQEDraw produces");
  await expect(helpDialog).toContainText("Citation: Joan Caceres");
  await expect(helpDialog).toContainText("v0.2.0");
  await expect(helpDialog.getByRole("link", { name: "Citation file" })).toBeVisible();
  await expect(helpDialog.getByRole("link", { name: "Report an issue" })).toBeVisible();
  await expect(helpDialog.getByRole("link", { name: "Contact Joan" })).toBeVisible();
  await expect(helpDialog).toContainText("Use Node and click the canvas");
  await expect(helpDialog).toContainText("Use New project to clear the drawing");
  await expect(helpDialog).toContainText("Cj, 40e-15, Lgeom, and Lj");
  await expect(helpDialog).toContainText("mode-frequency and Josephson phase-ZPF");
  await expect(helpDialog).toContainText("does not include external loop flux");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(helpDialog.getByRole("link", { name: "Citation file" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(helpDialog).toBeHidden();
  await expect(helpButton).toBeFocused();

  await helpButton.click();
  await expect(helpDialog).toBeVisible();
  await closeButton.click();
  await expect(helpDialog).toBeHidden();

  await canvas.click({ position: { x: 820, y: 520 } });
  await expect(canvasHint).toBeHidden();
});

test("loads a sample circuit from the first-run canvas", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cqedraw.tutorial.v1", "dismissed");
  });
  await page.goto("/");

  await page
    .getByTestId("canvas-hint")
    .getByRole("button", { name: "Load example circuit" })
    .click();

  await expect(page.getByTestId("canvas-hint")).toBeHidden();
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("node-2")).toBeVisible();
  await expect(page.getByTestId("edge-0")).toBeVisible();
  await expect(page.getByTestId("edge-1")).toBeVisible();
  await expect(page.getByTestId("output-status")).toContainText(
    "Loaded example circuit.",
  );
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
});

test("keeps compact toolbar buttons accessible with hover and keyboard-focus tooltips", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cqedraw.tutorial.v1", "dismissed");
  });
  await page.goto("/");

  const selectButton = page.getByRole("button", {
    exact: true,
    name: "Select",
  });
  await expect(selectButton).toHaveAttribute("aria-label", "Select");
  await expect(selectButton).toHaveAttribute("title", "Select (V)");
  await expect(selectButton.locator(".tool-button-tooltip")).toBeHidden();
  await expect(selectButton.locator(".tool-button-tooltip")).toHaveAttribute(
    "aria-hidden",
    "true",
  );

  await selectButton.hover();
  await expect(selectButton.locator(".tool-button-tooltip")).toBeVisible();
  await expect(selectButton.locator(".tool-button-tooltip")).toContainText(
    "Select (V)",
  );
  await page.mouse.move(0, 0);
  await expect(selectButton.locator(".tool-button-tooltip")).toBeHidden();

  const boxSelectButton = page.getByRole("button", {
    exact: true,
    name: "Box Select",
  });
  await expect(boxSelectButton).toHaveAttribute("aria-label", "Box Select");
  await expect(boxSelectButton).toHaveAttribute("title", "Box Select (B)");

  const undoButton = page.getByRole("button", {
    exact: true,
    name: "Undo",
  });
  const redoButton = page.getByRole("button", {
    exact: true,
    name: "Redo",
  });
  await expect(undoButton).toHaveAttribute("aria-label", "Undo");
  await expect(undoButton).toHaveAttribute("title", "Undo (Ctrl/Cmd+Z)");
  await expect(redoButton).toHaveAttribute("aria-label", "Redo");
  await expect(redoButton).toHaveAttribute("title", "Redo (Ctrl/Cmd+Y)");

  await expect(page.getByRole("button", { name: "Delete" })).toHaveAttribute(
    "title",
    "Delete (Del/Backspace)",
  );
  await expect(page.getByRole("button", { name: "Merge" })).toHaveAttribute(
    "title",
    "Merge (M)",
  );
  await expect(page.getByRole("button", { exact: true, name: "Output" })).toHaveAttribute(
    "title",
    "Output",
  );
  await openOutputDrawer(page);
  await expect(page.getByRole("button", { exact: true, name: "Copy matrices" })).toHaveAttribute(
    "title",
    "Prepare matrices and copy when ready",
  );
  await closeOutputDrawer(page);
  await expect(page.getByRole("button", { name: "Save" })).toHaveAttribute(
    "title",
    "Save (Ctrl/Cmd+S)",
  );
  await expect(
    page.getByRole("button", { exact: true, name: "Load" }),
  ).toHaveAttribute("title", "Load (Ctrl/Cmd+O)");
  await expect(
    page.getByRole("button", { name: "Copy Selection" }),
  ).toHaveAttribute("title", "Copy Selection (Ctrl/Cmd+C)");

  const pasteButton = page.getByRole("button", {
    exact: true,
    name: "Paste",
  });
  await expect(pasteButton).toHaveAttribute("aria-label", "Paste");
  await expect(pasteButton).toHaveAttribute("title", "Paste (Ctrl/Cmd+V)");
  await page.keyboard.press("Tab");
  await expect(selectButton).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(pasteButton).toBeFocused();
  await expect(pasteButton.locator(".tool-button-tooltip")).toBeVisible();
  await expect(pasteButton.locator(".tool-button-tooltip")).toContainText(
    "Paste (Ctrl/Cmd+V)",
  );
});

test("restarts the tutorial from Help and confirms before clearing a project", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  const helpButton = page.getByRole("button", { name: "Help" });
  await canvas.click({ position: { x: 160, y: 220 } });

  await helpButton.click();
  await page.getByRole("button", { name: "Start tutorial" }).click();

  const resetDialog = page.getByRole("dialog", { name: "Start tutorial?" });
  const cancelButton = resetDialog.getByRole("button", { name: "Cancel" });
  const startButton = resetDialog.getByRole("button", { name: "Start tutorial" });
  await expect(resetDialog).toBeVisible();
  await expect(cancelButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(startButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancelButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(resetDialog).toBeHidden();
  await expect(helpButton).toBeFocused();
  await expect(page.getByTestId("node-0")).toBeVisible();

  await helpButton.click();
  await page.getByRole("button", { name: "Start tutorial" }).click();
  await startButton.click();

  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Build a small circuit",
  );
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expectBeforeUnloadProtection(page, false);
  await expect(
    page.getByTestId("tutorial-callout").getByRole("button", { name: "Start" }),
  ).toBeFocused();
  await expect(page.getByTestId("node-0")).toBeHidden();
  await expect(page.getByTestId("canvas-hint")).toBeHidden();
});

test("completes the optional onboarding tutorial", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page
    .getByTestId("tutorial-prompt")
    .getByRole("button", { name: "Start tutorial" })
    .click();
  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Build a small circuit",
  );

  await page.getByTestId("tutorial-callout").getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Place the first node",
  );

  await canvas.click({ position: { x: 160, y: 220 } });
  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Place the second node",
  );

  await canvas.click({ position: { x: 330, y: 220 } });
  await expect(page.getByTestId("tutorial-callout")).toContainText("Switch to Edge");

  await page.getByRole("button", { name: "Edge" }).click();
  await expect(page.getByTestId("tutorial-callout")).toContainText("Connect the nodes");
  await expect(page.getByTestId("node-0")).toHaveClass(/tutorial-target/);

  await page.getByTestId("node-0").click();
  await expect(page.getByTestId("node-1")).toHaveClass(/tutorial-target/);
  await page.getByTestId("node-1").click();
  await expect(page.getByTestId("tutorial-callout")).toContainText("Enter edge values");

  await page.getByTestId("cap-input").fill("C");
  await page.getByTestId("ind-input").fill("L");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Switch to Ground");

  await page.getByRole("button", { name: "Ground" }).click();
  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Add the ground reference",
  );
  await expect(page.getByTestId("node-1")).toHaveClass(/tutorial-target/);

  await page.getByTestId("node-1").click();
  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Enter ground capacitance",
  );
  await expect(page.getByTestId("cap-input")).toHaveClass(/tutorial-highlight-control/);
  await expect(page.getByTestId("ind-input")).not.toHaveClass(
    /tutorial-highlight-control/,
  );

  await page.getByTestId("cap-input").fill("Cg");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Edit existing values");
  await page.getByTestId("edge-0").click({ force: true });
  await expect(page.getByTestId("tutorial-callout")).toContainText("Prepare matrices");

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);
  await expect(page.getByTestId("tutorial-callout")).toContainText("Copy matrices");

  await page.getByRole("button", { exact: true, name: "Copy matrices" }).click();
  await expect(page.getByTestId("output-status")).toContainText(
    "Copied matrices to clipboard. Paste them into Python or a notebook.",
  );
  await expect(page.getByTestId("output-status")).toHaveClass(/status-line-success/);
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toContainText("Copied");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Tutorial complete");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Save and Load");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("tutorial-callout")).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("tutorial-prompt")).toBeHidden();
});
