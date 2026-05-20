import { Buffer } from "node:buffer";

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

  await canvas.hover({ position: { x: 80, y: 80 } });
  await page.mouse.wheel(0, -320);
  const wheelZoomedView = await waitForViewBox(
    canvas,
    (viewBox) => viewBox.width < fittedView.width,
  );
  expect(wheelZoomedView.width).toBeLessThan(fittedView.width);
  expect(viewCenterX(wheelZoomedView)).toBeLessThan(viewCenterX(fittedView));
  expect(viewCenterY(wheelZoomedView)).toBeLessThan(viewCenterY(fittedView));

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

  await mergeButton.click();

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
});

test("selects nodes with a shift-drag marquee and clears empty boxes", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });
  await canvas.click({ position: { x: 500, y: 220 } });

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const mergeButton = page.getByRole("button", { name: "Merge" });
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) {
    throw new Error("Canvas box is unavailable.");
  }

  await page.keyboard.down("Shift");
  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 380, canvasBox.y + 260);
  await expect(page.getByTestId("selection-marquee")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(page.getByTestId("selection-marquee")).toHaveCount(0);
  await expect(page.getByText("2 nodes selected")).toBeVisible();
  await expect(page.getByText("Merge will keep node 1")).toBeVisible();
  await expect(mergeButton).toBeEnabled();

  const node0 = page.getByTestId("node-0");
  const node1 = page.getByTestId("node-1");
  const node2 = page.getByTestId("node-2");
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
  await page.getByRole("button", { exact: true, name: "Copy Selection" }).click();
  await expect(page.getByTestId("output-status")).toContainText(
    "Copied 2 node(s) to clipboard.",
  );

  await page.getByRole("button", { exact: true, name: "Paste" }).click();
  await expect(page.getByTestId("paste-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("paste-preview")).toHaveCount(0);
  await expect(page.getByTestId("node-2")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Paste cancelled.");

  await page.getByRole("button", { exact: true, name: "Paste" }).click();
  await expect(page.getByTestId("paste-preview")).toBeVisible();
  await page.getByRole("button", { name: "Node" }).click();
  await expect(page.getByTestId("paste-preview")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText("Paste cancelled.");
  await expect(page.getByTestId("node-2")).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: "Paste" }).click();
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
