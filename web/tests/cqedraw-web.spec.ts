import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

const CANVAS_WIDTH = 900;
const OLD_MAX_VIEW_WIDTH = CANVAS_WIDTH * 3;

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

test("supports core web keyboard shortcuts without changing generated output", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  const selectButton = page.getByRole("button", { exact: true, name: "Select" });
  const boxSelectButton = page.getByRole("button", {
    exact: true,
    name: "Box Select",
  });
  const nodeButton = page.getByRole("button", { exact: true, name: "Node" });
  const edgeButton = page.getByRole("button", { exact: true, name: "Edge" });
  const groundButton = page.getByRole("button", { exact: true, name: "Ground" });

  await page.keyboard.press("v");
  await expect(selectButton).toHaveClass(/active/);
  await page.keyboard.press("b");
  await expect(boxSelectButton).toHaveClass(/active/);
  await page.keyboard.press("n");
  await expect(nodeButton).toHaveClass(/active/);
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });

  await page.keyboard.press("e");
  await expect(edgeButton).toHaveClass(/active/);
  await page.getByTestId("node-0").click();
  await expect(page.getByTestId("node-0")).toHaveClass(/pending/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("node-0")).not.toHaveClass(/pending/);
  await expect(selectButton).toHaveClass(/active/);

  await page.keyboard.press("e");
  await expect(edgeButton).toHaveClass(/active/);
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("C12");
  await page.getByTestId("ind-input").fill("1/L12_inv");
  await page.getByTestId("ind-input").evaluate((element: HTMLInputElement) => element.blur());

  await page.keyboard.press("g");
  await expect(groundButton).toHaveClass(/active/);
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("Cg");
  await page.getByTestId("ind-input").fill("1/Lg_inv");
  await page.getByTestId("ind-input").evaluate((element: HTMLInputElement) => element.blur());

  await page.keyboard.press("Control+Enter");
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 0) = C12");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 1) = -C12");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C12 + Cg");
  await expect(page.getByTestId("l-entries")).toContainText("(0, 0) = L12_inv");
  await expect(page.getByTestId("l-entries")).toContainText(
    "(1, 1) = L12_inv + Lg_inv",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Control+S");
  await downloadPromise;
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+O");
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "shortcut-loaded-project.json",
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
  await expect(page.getByText("Loaded")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
});

test("deletes selections without stealing inspector text entry", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.keyboard.press("n");
  await canvas.click({ position: { x: 160, y: 220 } });
  await page.keyboard.press("v");
  await page.getByTestId("node-0").click();

  const nodeNameInput = page.getByTestId("node-name-input");
  await expect(nodeNameInput).toHaveValue("N1");
  await nodeNameInput.focus();
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("node-0")).toBeVisible();

  await nodeNameInput.evaluate((element: HTMLInputElement) => element.blur());
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Deleted 1 node.");

  await page.keyboard.press("n");
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });
  await page.keyboard.press("e");
  await page.getByTestId("node-1").click();
  await page.getByTestId("node-2").click();

  await page.getByRole("button", { exact: true, name: "Box Select" }).click();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error("Canvas box is unavailable.");
  }
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 360, canvasBox.y + 260);
  await page.mouse.up();

  await expect(page.getByTestId("output-status")).toContainText("Selected 2 nodes.");
  await page.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByTestId("node-1")).toHaveCount(0);
  await expect(page.getByTestId("node-2")).toHaveCount(0);
  await expect(page.getByTestId("edge-0")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Deleted 2 nodes and 1 connection.",
  );
  await expect(page.getByTestId("output-status")).not.toContainText(
    "Selected 2 nodes.",
  );

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("node-2")).toBeVisible();
  await expect(page.getByTestId("edge-0")).toHaveCount(1);
  await expect(page.getByTestId("output-status")).toContainText(
    "Undid last change.",
  );

  await page.keyboard.press("Control+Y");
  await expect(page.getByTestId("node-1")).toHaveCount(0);
  await expect(page.getByTestId("node-2")).toHaveCount(0);
  await expect(page.getByTestId("edge-0")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Redid last change.",
  );
});

test("renders component symbols for regular and ground edge values", async ({
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
  const regularSymbol = page.getByTestId("edge-symbol-0");
  await expect(regularSymbol).toHaveCount(0);

  await page.getByTestId("cap-input").fill("C12");
  await expect(regularSymbol).toHaveAttribute(
    "data-component-kind",
    "capacitor",
  );
  const standaloneCapacitorPlateHeight = await capacitorPlateHeight(regularSymbol);
  await expect(page.getByTestId("edge-value-cap-0")).toContainText("C=C12");
  await expect(page.getByTestId("edge-value-ind-0")).toHaveCount(0);
  await page.getByTestId("edge-0").click({ force: true });
  await expect(page.getByTestId("cap-input")).toHaveValue("C12");

  await page.getByTestId("cap-input").fill("");
  await page.getByTestId("ind-input").fill("1/L12_inv");
  await expect(regularSymbol).toHaveAttribute(
    "data-component-kind",
    "inductor",
  );
  await expect(page.getByTestId("edge-value-cap-0")).toHaveCount(0);
  await expect(page.getByTestId("edge-value-ind-0")).toContainText(
    "L=1/L12_inv",
  );

  await page.getByTestId("cap-input").fill("C12");
  await expect(regularSymbol).toHaveAttribute(
    "data-component-kind",
    "parallel-lc",
  );
  expect(await capacitorPlateHeight(regularSymbol)).toBeCloseTo(
    standaloneCapacitorPlateHeight,
    1,
  );
  await expect(page.getByTestId("edge-value-cap-0")).toContainText("C=C12");
  await expect(page.getByTestId("edge-value-ind-0")).toContainText(
    "L=1/L12_inv",
  );

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  const groundSymbol = page.getByTestId("edge-symbol-1");
  await expect(groundSymbol).toHaveCount(0);

  await page.getByTestId("cap-input").fill("Cg");
  await expect(groundSymbol).toHaveAttribute(
    "data-component-kind",
    "capacitor",
  );
  await expect(page.getByTestId("edge-value-cap-1")).toContainText("C=Cg");
  await expect(page.getByTestId("edge-value-ind-1")).toHaveCount(0);

  await page.getByTestId("cap-input").fill("");
  await page.getByTestId("ind-input").fill("1/Lg_inv");
  await expect(groundSymbol).toHaveAttribute(
    "data-component-kind",
    "inductor",
  );
  await expect(page.getByTestId("edge-value-cap-1")).toHaveCount(0);
  await expect(page.getByTestId("edge-value-ind-1")).toContainText(
    "L=1/Lg_inv",
  );

  await page.getByTestId("cap-input").fill("Cg");
  await expect(groundSymbol).toHaveAttribute(
    "data-component-kind",
    "parallel-lc",
  );
  await expect(page.getByTestId("edge-value-cap-1")).toContainText("C=Cg");
  await expect(page.getByTestId("edge-value-ind-1")).toContainText(
    "L=1/Lg_inv",
  );

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 0) = C12");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 1) = -C12");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C12 + Cg");
  await expect(page.getByTestId("l-entries")).toContainText("(0, 0) = L12_inv");
  await expect(page.getByTestId("l-entries")).toContainText(
    "(1, 1) = L12_inv + Lg_inv",
  );

  await page.locator('input[type="file"]').setInputFiles({
    name: "reversed-and-short-symbols.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        state: {
          nodes: [
            { identifier: 0, name: "A", x: 180, y: 220 },
            { identifier: 1, name: "B", x: 340, y: 220 },
            { identifier: 2, name: "C", x: 440, y: 220 },
            { identifier: 3, name: "D", x: 460, y: 220 },
          ],
          edges: [
            {
              identifier: 0,
              nodes: [1, 0],
              capacitance_text: "Crev",
              inductance_text: "Lrev",
              is_ground: false,
            },
            {
              identifier: 1,
              nodes: [2, 3],
              capacitance_text: "Cs",
              inductance_text: "Ls",
              is_ground: false,
            },
            {
              identifier: 2,
              nodes: [0, 1],
              capacitance_text: "   ",
              inductance_text: "\t",
              is_ground: false,
            },
          ],
        },
      }),
    ),
  });
  await expect(page.getByTestId("edge-symbol-0")).toHaveAttribute(
    "data-component-kind",
    "parallel-lc",
  );
  await expect(page.getByTestId("edge-value-cap-0")).toContainText("C=Crev");
  await expect(page.getByTestId("edge-value-ind-0")).toContainText("L=Lrev");
  expect(Number(await page.getByTestId("edge-value-cap-0").getAttribute("y"))).toBeLessThan(
    220,
  );
  expect(Number(await page.getByTestId("edge-value-ind-0").getAttribute("y"))).toBeGreaterThan(
    220,
  );
  await expect(page.getByTestId("edge-symbol-2")).toHaveCount(0);
  await expect(page.getByTestId("edge-value-cap-2")).toHaveCount(0);
  await expect(page.getByTestId("edge-value-ind-2")).toHaveCount(0);
  expect(await symbolCoordinatesStayWithinHalfLength(page, "edge-symbol-1", 10)).toBe(
    true,
  );
});

test("moves ground branches without changing generated output", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 180, y: 220 } });
  await canvas.click({ position: { x: 340, y: 220 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("C12");
  await page.getByTestId("ind-input").fill("1/L12_inv");

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("Cg");
  await page.getByTestId("ind-input").fill("1/Lg_inv");

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C12 + Cg");
  await expect(page.getByTestId("l-entries")).toContainText(
    "(1, 1) = L12_inv + Lg_inv",
  );

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const groundEdge = page.getByTestId("edge-1");
  const beforeMove = await parseSvgLine(groundEdge);
  expect(Math.abs(beforeMove.x2 - beforeMove.x1)).toBeLessThan(1);
  expect(Math.abs(beforeMove.y2 - beforeMove.y1 - 104)).toBeLessThan(1);

  const groundBox = await page.getByTestId("ground-symbol-1").boundingBox();
  if (!groundBox) {
    throw new Error("Ground symbol box is unavailable.");
  }
  await page.mouse.move(
    groundBox.x + groundBox.width / 2,
    groundBox.y + groundBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    groundBox.x + groundBox.width / 2 + 95,
    groundBox.y + groundBox.height / 2 - 70,
  );
  await page.mouse.up();

  const afterMove = await parseSvgLine(groundEdge);
  expect(afterMove.x2 - beforeMove.x2).toBeGreaterThan(50);
  expect(afterMove.y2 - beforeMove.y2).toBeLessThan(-35);
  expect(Math.abs(await parseSvgRotation(page.getByTestId("ground-symbol-1")))).toBeGreaterThan(
    10,
  );
  await expect(page.getByTestId("ground-symbol-1")).toHaveClass(/selected/);

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C12 + Cg");
  await expect(page.getByTestId("l-entries")).toContainText(
    "(1, 1) = L12_inv + Lg_inv",
  );

  await page.keyboard.press("Control+Z");
  const afterUndo = await parseSvgLine(groundEdge);
  expect(afterUndo.x2).toBeCloseTo(beforeMove.x2, 3);
  expect(afterUndo.y2).toBeCloseTo(beforeMove.y2, 3);

  await page.keyboard.press("Control+Y");
  const afterRedo = await parseSvgLine(groundEdge);
  expect(afterRedo.x2).toBeCloseTo(afterMove.x2, 3);
  expect(afterRedo.y2).toBeCloseTo(afterMove.y2, 3);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Saved project download path is unavailable.");
  }
  const savedProject = JSON.parse(await readFile(downloadPath, "utf8"));
  const savedGround = savedProject.state.edges.find(
    (edge: { identifier: number }) => edge.identifier === 1,
  );
  expect(savedGround).toMatchObject({
    identifier: 1,
    is_ground: true,
  });
  expect(savedGround.ground_offset_x).toBeCloseTo(afterMove.x2 - afterMove.x1, 3);
  expect(savedGround.ground_offset_y).toBeCloseTo(afterMove.y2 - afterMove.y1, 3);

  await page.locator('input[type="file"]').setInputFiles({
    name: "moved-ground-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(savedProject)),
  });

  const afterLoad = await parseSvgLine(groundEdge);
  expect(afterLoad.x2).toBeCloseTo(afterMove.x2, 3);
  expect(afterLoad.y2).toBeCloseTo(afterMove.y2, 3);
});

test("guides a first-time web user without blocking drawing", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await expect(page.getByTestId("canvas-hint")).toContainText(
    "Click the canvas to place nodes.",
  );
  await expect(page.getByTestId("canvas-hint")).toContainText(
    "Generate and Copy create the Python matrix snippet.",
  );

  await page.getByRole("button", { name: "Help" }).click();
  const helpDialog = page.getByRole("dialog", { name: "Help" });
  const helpButton = page.getByRole("button", { name: "Help" });
  const closeButton = page.getByRole("button", { name: "Close" });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog).toContainText("Use Node and click the canvas");
  await expect(helpDialog).toContainText("Cj, 40e-15, and 1/Lj_inv");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(helpDialog.getByRole("button", { name: "Start tutorial" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(helpDialog).toBeHidden();
  await expect(helpButton).toBeFocused();

  await helpButton.click();
  await expect(helpDialog).toBeVisible();
  await closeButton.click();
  await expect(helpDialog).toBeHidden();

  await canvas.click({ position: { x: 160, y: 220 } });
  await expect(page.getByTestId("canvas-hint")).toBeHidden();
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
  await expect(page.getByRole("button", { name: "Generate" })).toHaveAttribute(
    "title",
    "Generate (Ctrl/Cmd+Enter)",
  );
  await expect(page.getByRole("button", { name: "Save" })).toHaveAttribute(
    "title",
    "Save (Ctrl/Cmd+S)",
  );
  await expect(page.getByRole("button", { name: "Load" })).toHaveAttribute(
    "title",
    "Load (Ctrl/Cmd+O)",
  );
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
  await expect(page.getByTestId("canvas-hint")).toBeVisible();
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

  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await expect(page.getByTestId("tutorial-callout")).toContainText("Enter edge values");

  await page.getByTestId("cap-input").fill("C");
  await page.getByTestId("ind-input").fill("L");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Switch to Ground");

  await page.getByRole("button", { name: "Ground" }).click();
  await expect(page.getByTestId("tutorial-callout")).toContainText(
    "Add the ground reference",
  );

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
  await expect(page.getByTestId("tutorial-callout")).toContainText("Generate matrices");

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C + Cg");
  await expect(page.getByTestId("l-entries")).toContainText("(1, 1) = 1/L");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Copy the snippet");

  await page.getByRole("button", { exact: true, name: "Copy" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Snippet copied.");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Tutorial complete");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Save and Load");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("tutorial-callout")).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("tutorial-prompt")).toBeHidden();
});

test("zooms, pans, fits the view, and keeps dragged nodes recoverable", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });

  const grid = page.getByTestId("grid-surface");
  const initialView = parseViewBox(await canvas.getAttribute("viewBox"));
  await expectGridCoversView(grid, initialView);
  await page.getByRole("button", { name: "Zoom in" }).click();
  const zoomedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(zoomedView.width).toBeLessThan(initialView.width);

  for (let step = 0; step < 7; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  const wideView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(wideView.width).toBeGreaterThan(OLD_MAX_VIEW_WIDTH);
  await expectGridCoversView(grid, wideView);

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error("Canvas box is unavailable.");
  }

  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 260);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 440, canvasBox.y + 320);
  await page.mouse.up();

  const pannedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(pannedView.x).toBeLessThan(wideView.x);
  await expectGridCoversView(grid, pannedView);

  await page.getByRole("button", { name: "Fit view" }).click();
  const fittedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(fittedView.width).toBeGreaterThanOrEqual(899);
  expect(fittedView.width).toBeLessThan(wideView.width);
  await expectGridCoversView(grid, fittedView);

  await page.evaluate(() => {
    document.documentElement.style.minHeight = "200vh";
    document.body.style.minHeight = "200vh";
    window.scrollTo(0, 40);
  });
  try {
    const pageScrollBeforeWheel = await page.evaluate(() => window.scrollY);
    await canvas.hover({ position: { x: 80, y: 80 } });
    await page.mouse.wheel(0, -320);
    const wheelZoomedView = await waitForViewBox(
      canvas,
      (viewBox) => viewBox.width < fittedView.width,
    );
    expect(wheelZoomedView.width).toBeLessThan(fittedView.width);
    expect(viewCenterX(wheelZoomedView)).toBeLessThan(viewCenterX(fittedView));
    expect(viewCenterY(wheelZoomedView)).toBeLessThan(viewCenterY(fittedView));
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeWheel);

    await page.mouse.wheel(0, 320);
    const wheelZoomedOutView = await waitForViewBox(
      canvas,
      (viewBox) => viewBox.width > wheelZoomedView.width,
    );
    expect(wheelZoomedOutView.width).toBeGreaterThan(wheelZoomedView.width);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeWheel);
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.minHeight = "";
      document.body.style.minHeight = "";
      window.scrollTo(0, 0);
    });
  }

  await page.getByRole("button", { name: "Fit view" }).click();

  const node = page.getByTestId("node-0");
  const nodeBox = await node.boundingBox();
  if (!nodeBox) {
    throw new Error("Node box is unavailable.");
  }

  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 1, canvasBox.y + 1);
  await page.mouse.up();

  const draggedView = parseViewBox(await canvas.getAttribute("viewBox"));
  const cx = Number(await node.getAttribute("cx"));
  const cy = Number(await node.getAttribute("cy"));
  expect(cx).toBeGreaterThanOrEqual(draggedView.x + 14);
  expect(cy).toBeGreaterThanOrEqual(draggedView.y + 14);
});

test("selects multiple nodes and merges them into the focused node", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });
  await canvas.click({ position: { x: 500, y: 220 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("C01");
  await page.getByTestId("node-1").click();
  await page.getByTestId("node-2").click();
  await page.getByTestId("cap-input").fill("C12");

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const mergeButton = page.getByRole("button", { name: "Merge" });
  await expect(mergeButton).toBeDisabled();
  await page.getByTestId("node-0").click();
  await expect(mergeButton).toBeDisabled();
  await page.getByTestId("node-1").click({ modifiers: ["Shift"] });
  await expect(mergeButton).toBeEnabled();
  await expect(page.getByText("2 nodes selected")).toBeVisible();

  await page.keyboard.press("m");

  await expect(page.getByTestId("output-status")).toContainText(
    "Merged 2 nodes into N2",
  );
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("edge-0")).toHaveCount(0);
  await expect(page.getByTestId("edge-1")).toHaveCount(1);

  await page.getByRole("button", { name: "Generate" }).click();

  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).not.toContainText("C01");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 0) = C12");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 1) = -C12");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C12");

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("output-status")).toContainText(
    "Undid last change.",
  );
  await expect(page.getByTestId("node-0")).toBeVisible();
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("edge-0")).toHaveCount(1);
  await expect(page.getByTestId("edge-1")).toHaveCount(1);

  await page.keyboard.press("Control+Y");
  await expect(page.getByTestId("output-status")).toContainText(
    "Redid last change.",
  );
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("edge-0")).toHaveCount(0);
  await expect(page.getByTestId("edge-1")).toHaveCount(1);
});

test("selects nodes with box select mode and keeps shift-drag shortcut", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });
  await canvas.click({ position: { x: 500, y: 220 } });

  await page.getByRole("button", { exact: true, name: "Box Select" }).click();
  const mergeButton = page.getByRole("button", { name: "Merge" });
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error("Canvas box is unavailable.");
  }
  const node0 = page.getByTestId("node-0");
  const node1 = page.getByTestId("node-1");
  const node2 = page.getByTestId("node-2");

  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 380, canvasBox.y + 260);
  await expect(page.getByTestId("selection-marquee")).toBeVisible();
  await page.mouse.up();

  await expect(page.getByTestId("selection-marquee")).toHaveCount(0);
  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(page.getByText("Merge will keep node 1")).toBeVisible();
  await expect(mergeButton).toBeEnabled();
  await expect(page.getByTestId("output-status")).toContainText("Selected 2 nodes.");

  await canvas.click({ position: { x: 760, y: 440 } });
  await expect(page.getByText("2 nodes selected")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Selection cleared.",
  );

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await node0.click();
  await expect(node0).toHaveClass(/selected/);
  await expect(page.getByTestId("output-status")).toContainText("Selected 1 node.");

  await node1.click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(page.getByTestId("output-status")).toContainText("Selected 2 nodes.");

  await node0.click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 nodes selected")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Selected 1 node.");

  await canvas.click({ position: { x: 760, y: 440 } });
  await expect(page.getByTestId("output-status")).toContainText(
    "Selection cleared.",
  );

  await page.getByRole("button", { exact: true, name: "Box Select" }).click();
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 380, canvasBox.y + 260);
  await page.mouse.up();

  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(mergeButton).toBeEnabled();

  const node0Start = await parseSvgCircleCenter(node0);
  const node1Start = await parseSvgCircleCenter(node1);
  const node2Start = await parseSvgCircleCenter(node2);
  const node0Box = await node0.boundingBox();
  if (!node0Box) {
    throw new Error("Node box is unavailable.");
  }

  await page.mouse.move(
    node0Box.x + node0Box.width / 2,
    node0Box.y + node0Box.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    node0Box.x + node0Box.width / 2 + 80,
    node0Box.y + node0Box.height / 2 + 45,
  );
  await page.mouse.up();

  const node0End = await parseSvgCircleCenter(node0);
  const node1End = await parseSvgCircleCenter(node1);
  const node2End = await parseSvgCircleCenter(node2);
  const node0Delta = {
    x: node0End.x - node0Start.x,
    y: node0End.y - node0Start.y,
  };
  const node1Delta = {
    x: node1End.x - node1Start.x,
    y: node1End.y - node1Start.y,
  };
  expect(node0Delta.x).toBeGreaterThan(20);
  expect(node0Delta.y).toBeGreaterThan(20);
  expect(Math.abs(node1Delta.x - node0Delta.x)).toBeLessThan(1);
  expect(Math.abs(node1Delta.y - node0Delta.y)).toBeLessThan(1);
  expect(Math.abs(node2End.x - node2Start.x)).toBeLessThan(1);
  expect(Math.abs(node2End.y - node2Start.y)).toBeLessThan(1);
  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(mergeButton).toBeEnabled();

  await mergeButton.click();
  await expect(page.getByTestId("output-status")).toContainText(
    "Merged 2 nodes into N2",
  );
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("node-2")).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox.x + 650, canvasBox.y + 360);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 720, canvasBox.y + 420);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(page.getByTestId("output-status")).toContainText(
    "Selection cleared.",
  );
  await expect(page.getByText("2 nodes")).toBeVisible();
  await expect(mergeButton).toBeDisabled();
});

test("copies selected graph elements and pastes them from a preview", async ({
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
  await page.getByTestId("cap-input").fill("C12");
  await page.getByTestId("ind-input").fill("1/L12_inv");

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("Cg");
  await page.getByTestId("ind-input").fill("1/Lg_inv");

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+C");
  await expect(page.getByTestId("output-status")).toContainText(
    "Copied 2 node(s) to clipboard.",
  );

  await page.keyboard.press("Control+V");
  await expect(page.getByTestId("paste-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("paste-preview")).toHaveCount(0);
  await expect(page.getByTestId("node-2")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Paste cancelled.");

  await page.keyboard.press("Control+V");
  await expect(page.getByTestId("paste-preview")).toBeVisible();
  await page.getByRole("button", { name: "Node" }).click();
  await expect(page.getByTestId("paste-preview")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Paste cancelled.");
  await expect(page.getByTestId("node-2")).toHaveCount(0);

  await page.keyboard.press("Control+V");
  await expect(page.getByTestId("paste-preview")).toBeVisible();
  await page.getByTestId("edge-0").click({ force: true });

  await expect(page.getByTestId("paste-preview")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Pasted 2 node(s).");
  await expect(page.getByTestId("node-2")).toBeVisible();
  await expect(page.getByTestId("node-3")).toBeVisible();
  await expect(page.getByText("N3")).toBeVisible();
  await expect(page.getByText("N4")).toBeVisible();
  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(page.getByText("Merge will keep node 3")).toBeVisible();

  const node3Center = await parseSvgCircleCenter(page.getByTestId("node-3"));
  const pastedGround = await parseSvgLine(page.getByTestId("edge-3"));
  expect(Math.abs(pastedGround.x1 - node3Center.x)).toBeLessThan(1);
  expect(Math.abs(pastedGround.y1 - node3Center.y)).toBeLessThan(1);
  expect(Math.abs(pastedGround.x2 - node3Center.x)).toBeLessThan(1);
  expect(Math.abs(pastedGround.y2 - node3Center.y - 104)).toBeLessThan(1);

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Generated 4 x 4");
  await expect(page.getByTestId("c-entries")).toContainText("(2, 2) = C12");
  await expect(page.getByTestId("c-entries")).toContainText("(3, 3) = C12 + Cg");
  await expect(page.getByTestId("l-entries")).toContainText("(2, 2) = L12_inv");
  await expect(page.getByTestId("l-entries")).toContainText(
    "(3, 3) = L12_inv + Lg_inv",
  );
});

test("concatenates selected graph blocks", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  const concatenateButton = page.getByRole("button", { name: "Concatenate" });
  await expect(concatenateButton).toBeDisabled();

  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("C12");
  await page.getByTestId("ind-input").fill("1/L12_inv");

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("Cg");
  await page.getByTestId("ind-input").fill("1/Lg_inv");

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click({ modifiers: ["Shift"] });
  await expect(concatenateButton).toBeEnabled();
  await expect(concatenateButton).toHaveAttribute("title", "Concatenate (D)");

  await page.keyboard.press("D");
  const dialog = page.getByRole("dialog", { name: "Concatenate selection" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(concatenateButton).toBeFocused();

  await page.keyboard.press("D");
  await expect(dialog).toBeVisible();
  await page.getByLabel("Connection ports").fill("");
  await dialog.getByRole("button", { name: "Concatenate" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Enter a port count from 0 to 1.",
  );
  await page.getByLabel("Connection ports").fill("1");
  await page.getByLabel("Number of repeats").fill("2");
  await dialog.getByRole("button", { name: "Concatenate" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Concatenated 2 repeats; added 2 node(s).",
  );
  await expect(page.getByTestId("node-2")).toBeVisible();
  await expect(page.getByTestId("node-3")).toBeVisible();
  await expect(page.getByTestId("edge-4")).toHaveCount(1);
  await expect(page.getByText("N3")).toBeVisible();
  await expect(page.getByText("N4")).toBeVisible();
  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(page.getByText("Merge will keep node 3")).toBeVisible();

  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Generated 4 x 4");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 0) = C12");
  await expect(page.getByTestId("c-entries")).toContainText(
    "(3, 3) = C12 + Cg",
  );
  await expect(page.getByTestId("l-entries")).toContainText("(0, 0) = L12_inv");
  await expect(page.getByTestId("l-entries")).toContainText(
    "(3, 3) = L12_inv + Lg_inv",
  );
});

test("concatenates selected graph blocks with multiple offset ports", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 180 } });
  await canvas.click({ position: { x: 172, y: 300 } });
  await canvas.click({ position: { x: 330, y: 180 } });
  await canvas.click({ position: { x: 338, y: 300 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-2").click();
  await page.getByTestId("cap-input").fill("Ct");
  await page.getByTestId("node-1").click();
  await page.getByTestId("node-3").click();
  await page.getByTestId("cap-input").fill("Cb");
  await page.getByTestId("node-2").click();
  await page.getByTestId("node-3").click();

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click({ modifiers: ["Shift"] });
  await page.getByTestId("node-2").click({ modifiers: ["Shift"] });
  await page.getByTestId("node-3").click({ modifiers: ["Shift"] });

  await page.getByRole("button", { name: "Concatenate" }).click();
  await expect(page.getByTestId("concatenate-port-input")).toHaveValue("2");
  await page
    .getByRole("dialog", { name: "Concatenate selection" })
    .getByRole("button", { name: "Concatenate" })
    .click();

  await expect(page.getByTestId("output-status")).toContainText(
    "Concatenated 1 repeat; added 2 node(s).",
  );
  await expect(page.getByTestId("node-4")).toBeVisible();
  await expect(page.getByTestId("node-5")).toBeVisible();

  const topTail = await parseSvgCircleCenter(page.getByTestId("node-2"));
  const bottomTail = await parseSvgCircleCenter(page.getByTestId("node-3"));
  const topRepeat = await parseSvgCircleCenter(page.getByTestId("node-4"));
  const bottomRepeat = await parseSvgCircleCenter(page.getByTestId("node-5"));
  const topBridge = await parseSvgLine(page.getByTestId("edge-3"));
  const bottomBridge = await parseSvgLine(page.getByTestId("edge-4"));

  expect(Math.abs(topBridge.x1 - topTail.x)).toBeLessThan(1);
  expect(Math.abs(topBridge.y1 - topTail.y)).toBeLessThan(1);
  expect(Math.abs(topBridge.x2 - topRepeat.x)).toBeLessThan(1);
  expect(Math.abs(topBridge.y2 - topRepeat.y)).toBeLessThan(1);
  expect(Math.abs(bottomBridge.x1 - bottomTail.x)).toBeLessThan(1);
  expect(Math.abs(bottomBridge.y1 - bottomTail.y)).toBeLessThan(1);
  expect(Math.abs(bottomBridge.x2 - bottomRepeat.x)).toBeLessThan(1);
  expect(Math.abs(bottomBridge.y2 - bottomRepeat.y)).toBeLessThan(1);
});

test("creates a small circuit and generates matching C and L_inv entries", async ({
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
  await page.getByTestId("cap-input").fill("C12");
  await page.getByTestId("ind-input").fill("1/L12_inv");

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("Cg");
  await page.getByTestId("ind-input").fill("1/Lg_inv");

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Fit view" }).click();
  for (let step = 0; step < 7; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error("Canvas box is unavailable.");
  }
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 240);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 420, canvasBox.y + 300);
  await page.mouse.up();
  await page.getByRole("button", { name: "Generate" }).click();

  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 0) = C12");
  await expect(page.getByTestId("c-entries")).toContainText("(0, 1) = -C12");
  await expect(page.getByTestId("c-entries")).toContainText("(1, 1) = C12 + Cg");
  await expect(page.getByTestId("l-entries")).toContainText("(0, 0) = L12_inv");
  await expect(page.getByTestId("l-entries")).toContainText("(1, 1) = L12_inv + Lg_inv");
  await expect(page.getByTestId("snippet-output")).toContainText("def C_matrix_func");
  await expect(page.getByTestId("snippet-output")).toContainText("def L_inv_matrix_func");
});

test("does not create duplicate edges between the same two nodes", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("C12");

  await page.getByTestId("node-1").click();
  await page.getByTestId("node-0").click();

  await expect(page.getByTestId("output-status")).toContainText(
    "A connection between those nodes already exists.",
  );
  await page.getByRole("button", { name: "Generate" }).click();

  await expect(page.getByTestId("c-entries")).toContainText("(0, 0) = C12");
  await expect(page.getByTestId("c-entries")).not.toContainText("2*C12");
});

async function symbolCoordinatesStayWithinHalfLength(
  page: Page,
  testId: string,
  halfLength: number,
) {
  return page.getByTestId(testId).evaluate((symbol, maxAbsCoordinate) => {
    const numericAttributes = Array.from(symbol.querySelectorAll("line"))
      .flatMap((line) => ["x1", "x2", "y1", "y2"].map((name) => line.getAttribute(name)))
      .filter((value): value is string => value !== null)
      .map(Number);
    const pathCoordinates = Array.from(symbol.querySelectorAll("path"))
      .flatMap((path) => path.getAttribute("d")?.match(/-?\d+(?:\.\d+)?/g) ?? [])
      .map(Number);
    return [...numericAttributes, ...pathCoordinates].every(
      (coordinate) => Math.abs(coordinate) <= maxAbsCoordinate + 0.1,
    );
  }, halfLength);
}

async function capacitorPlateHeight(symbol: Locator) {
  return symbol.evaluate((element) => {
    const plates = Array.from(
      element.querySelectorAll('[data-component-part="capacitor-plate"]'),
    );
    if (plates.length !== 2) {
      throw new Error(`Expected 2 capacitor plates, found ${plates.length}.`);
    }
    const finiteAttribute = (plate: Element, name: string) => {
      const value = plate.getAttribute(name);
      if (value === null) {
        throw new Error(`Missing capacitor plate ${name} attribute.`);
      }
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new Error(`Invalid capacitor plate ${name} attribute: ${value}.`);
      }
      return numberValue;
    };
    const heights = plates.map((plate) => {
      const y1 = finiteAttribute(plate, "y1");
      const y2 = finiteAttribute(plate, "y2");
      return Math.abs(y2 - y1);
    });
    if (Math.abs(heights[0] - heights[1]) > 0.1) {
      throw new Error(
        `Expected matching capacitor plate heights, found ${heights[0]} and ${heights[1]}.`,
      );
    }
    return heights[0];
  });
}

function parseViewBox(value: string | null) {
  if (!value) {
    throw new Error("Missing viewBox value.");
  }
  const [x, y, width, height] = value.split(" ").map(Number);
  return { x, y, width, height };
}

async function waitForViewBox(
  canvas: Locator,
  predicate: (viewBox: ReturnType<typeof parseViewBox>) => boolean,
) {
  await expect.poll(async () => {
    const viewBox = parseViewBox(await canvas.getAttribute("viewBox"));
    return predicate(viewBox);
  }).toBe(true);
  return parseViewBox(await canvas.getAttribute("viewBox"));
}

async function expectGridCoversView(
  grid: Locator,
  viewBox: ReturnType<typeof parseViewBox>,
) {
  const rect = await parseSvgRect(grid);
  expect(rect.x).toBeLessThanOrEqual(viewBox.x);
  expect(rect.y).toBeLessThanOrEqual(viewBox.y);
  expect(rect.x + rect.width).toBeGreaterThanOrEqual(viewBox.x + viewBox.width);
  expect(rect.y + rect.height).toBeGreaterThanOrEqual(viewBox.y + viewBox.height);
}

async function parseSvgRect(locator: Locator) {
  return {
    x: await numberAttribute(locator, "x"),
    y: await numberAttribute(locator, "y"),
    width: await numberAttribute(locator, "width"),
    height: await numberAttribute(locator, "height"),
  };
}

async function parseSvgCircleCenter(locator: Locator) {
  return {
    x: await numberAttribute(locator, "cx"),
    y: await numberAttribute(locator, "cy"),
  };
}

async function parseSvgLine(locator: Locator) {
  return {
    x1: await numberAttribute(locator, "x1"),
    y1: await numberAttribute(locator, "y1"),
    x2: await numberAttribute(locator, "x2"),
    y2: await numberAttribute(locator, "y2"),
  };
}

async function parseSvgRotation(locator: Locator) {
  const transform = await locator.getAttribute("transform");
  const match = transform?.match(/rotate\((-?\d+(?:\.\d+)?)\)/);
  if (!match) {
    throw new Error(`Missing rotate transform: ${transform}`);
  }
  return Number(match[1]);
}

async function numberAttribute(locator: Locator, name: string) {
  const value = await locator.getAttribute(name);
  if (value === null) {
    throw new Error(`Missing ${name} attribute.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name} attribute: ${value}`);
  }
  return parsed;
}

function viewCenterX(viewBox: { x: number; width: number }) {
  return viewBox.x + viewBox.width / 2;
}

function viewCenterY(viewBox: { y: number; height: number }) {
  return viewBox.y + viewBox.height / 2;
}

async function expectBeforeUnloadProtection(page: Page, expected: boolean) {
  await expect.poll(() => hasBeforeUnloadProtection(page)).toBe(expected);
}

async function hasBeforeUnloadProtection(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const wasAllowed = window.dispatchEvent(event);
    return !wasAllowed || event.defaultPrevented;
  });
}
