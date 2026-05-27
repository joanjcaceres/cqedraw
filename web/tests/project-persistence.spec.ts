import { Buffer } from "node:buffer";
import { expect, test } from "./fixtures";
import {
  CANVAS_WIDTH,
  clickBuildMatrices,
  closeOutputDrawer,
  parseViewBox,
  expectBeforeUnloadProtection,
} from "./helpers";

test("shows and persists the optional tutorial prompt", async ({ page }) => {
  await page.goto("/");

  const prompt = page.getByTestId("tutorial-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("New to cQEDraw?");

  await prompt.getByRole("button", { name: "Skip" }).click();
  await expect(prompt).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("tutorial-prompt")).toBeHidden();
});

test("prompts before closing only while the project has unsaved changes", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expectBeforeUnloadProtection(page, false);

  await canvas.click({ position: { x: 160, y: 220 } });
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await expectBeforeUnloadProtection(page, true);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save" }).click();
  await downloadPromise;
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expect(page.getByTestId("output-status")).toContainText("Project saved.");
  await expectBeforeUnloadProtection(page, false);

  await canvas.click({ position: { x: 330, y: 220 } });
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await expectBeforeUnloadProtection(page, true);

  await page.locator('input[type="file"]').setInputFiles({
    name: "loaded-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        state: {
          nodes: [{ identifier: 0, name: "Loaded", x: 250, y: 240 }],
          edges: [],
        },
      }),
    ),
  });
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expectBeforeUnloadProtection(page, false);
});

test("starts a new project after confirmation", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  const newProjectButton = page.getByRole("button", { name: "New project" });
  const nodeButton = page.getByRole("button", { exact: true, name: "Node" });
  const undoButton = page.getByRole("button", { name: "Undo" });
  const redoButton = page.getByRole("button", { name: "Redo" });
  await expect(newProjectButton).toBeDisabled();

  await canvas.click({ position: { x: 160, y: 220 } });
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(newProjectButton).toBeEnabled();
  await expect(undoButton).toBeEnabled();
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");
  await expectBeforeUnloadProtection(page, true);
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toHaveCount(0);

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 1 x 1");
  await expect(page.getByTestId("snippet-output")).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toBeVisible();
  await closeOutputDrawer(page);
  await page.getByRole("button", { name: "Zoom out" }).click();
  const zoomedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(zoomedView.width).toBeGreaterThan(CANVAS_WIDTH);

  await newProjectButton.click();
  const dialog = page.getByRole("dialog", { name: "Start new project?" });
  const cancelButton = dialog.getByRole("button", { name: "Cancel" });
  await expect(dialog).toBeVisible();
  await expect(cancelButton).toBeFocused();

  await cancelButton.click();
  await expect(dialog).toHaveCount(0);
  await expect(newProjectButton).toBeFocused();
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");

  await newProjectButton.click();
  await dialog.getByRole("button", { name: "Start new project" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("canvas-hint")).toBeVisible();
  await expect(page.getByTestId("output-status")).toContainText(
    "Started new project.",
  );
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expectBeforeUnloadProtection(page, false);
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toHaveCount(0);
  await expect(newProjectButton).toBeDisabled();
  await expect(nodeButton).toBeFocused();
  await expect(undoButton).toBeDisabled();
  await expect(redoButton).toBeDisabled();
  expect(parseViewBox(await canvas.getAttribute("viewBox"))).toEqual({
    x: 0,
    y: 0,
    width: 900,
    height: 620,
  });

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Nothing to undo.");
});

test("undoes and redoes node creation and deletion", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  const undoButton = page.getByRole("button", { name: "Undo" });
  const redoButton = page.getByRole("button", { name: "Redo" });
  await expect(undoButton).toBeDisabled();
  await expect(redoButton).toBeDisabled();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await canvas.click({ position: { x: 160, y: 220 } });
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(undoButton).toBeEnabled();
  await expect(redoButton).toBeDisabled();
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expect(undoButton).toBeDisabled();
  await expect(redoButton).toBeEnabled();

  await page.keyboard.press("Control+Y");
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Unsaved changes");

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("node-0")).toHaveCount(0);

  await undoButton.click();
  await expect(page.getByTestId("node-0")).toBeVisible();

  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByTestId("node-0")).toHaveCount(0);
});

test("does not intercept native undo while editing inspector fields", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });
  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();

  const capacitanceInput = page.getByTestId("cap-input");
  await capacitanceInput.fill("Ctest");
  await expect(capacitanceInput).toHaveValue("Ctest");
  await page.keyboard.press("Control+Z");

  await expect(page.getByTestId("output-status")).not.toContainText(
    "Undid last change.",
  );
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("edge-0")).toHaveCount(1);
});
