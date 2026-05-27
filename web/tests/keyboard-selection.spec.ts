import { Buffer } from "node:buffer";
import { expect, test } from "./fixtures";
import {
  OLD_MAX_VIEW_WIDTH,
  dismissTutorialPromptIfVisible,
  clickBuildMatrices,
  expectRawMatrixEntriesHidden,
  parseViewBox,
  waitForViewBox,
  expectGridCoversView,
  parseSvgCircleCenter,
  parseSvgLine,
  viewCenterX,
  viewCenterY,
} from "./helpers";

test("supports core web keyboard shortcuts without changing generated output", async ({
  page,
}) => {
  await page.goto("/");
  await dismissTutorialPromptIfVisible(page);

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
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2", {
    timeout: 60_000,
  });
  await expectRawMatrixEntriesHidden(page);

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
  await expect(page.getByTestId("node-matrix-label-0")).toContainText("0");
  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await expect(page.getByTestId("node-name-input")).toHaveValue("Loaded");
  await expect(page.getByTestId("node-matrix-index-input")).toHaveValue("0");
  await expect(page.getByTestId("save-status")).toContainText("Saved");
});

test("deletes selections without stealing inspector text entry", async ({
  page,
}) => {
  await page.goto("/");
  await dismissTutorialPromptIfVisible(page);

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

test("zooms, pans, fits the view, and keeps dragged nodes recoverable", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });

  const grid = page.getByTestId("grid-surface");
  const zoomInButton = page.getByRole("button", { name: "Zoom in" });
  const zoomOutButton = page.getByRole("button", { name: "Zoom out" });
  const fitViewButton = page.getByRole("button", { name: "Fit view" });
  await expect(zoomInButton).toHaveAttribute("title", "Zoom in (+/=)");
  await expect(zoomOutButton).toHaveAttribute("title", "Zoom out (-)");
  await expect(fitViewButton).toHaveAttribute("title", "Fit view (0)");

  const initialView = parseViewBox(await canvas.getAttribute("viewBox"));
  await expectGridCoversView(grid, initialView);
  await page.keyboard.press("=");
  const shortcutZoomedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(shortcutZoomedView.width).toBeLessThan(initialView.width);
  await page.keyboard.press("-");
  const shortcutZoomedOutView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(shortcutZoomedOutView.width).toBeCloseTo(initialView.width, 5);
  expect(shortcutZoomedOutView.height).toBeCloseTo(initialView.height, 5);
  await page.keyboard.press("=");
  await page.keyboard.press("0");
  const shortcutFittedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(shortcutFittedView.width).toBeGreaterThan(shortcutZoomedView.width);
  expect(shortcutFittedView.width).toBeGreaterThanOrEqual(899);

  const viewBeforeInspectorKeys = parseViewBox(await canvas.getAttribute("viewBox"));
  await page.getByTestId("node-name-input").click();
  await page.keyboard.press("=");
  await page.keyboard.press("-");
  await page.keyboard.press("0");
  expect(parseViewBox(await canvas.getAttribute("viewBox"))).toEqual(
    viewBeforeInspectorKeys,
  );

  await zoomInButton.click();
  const zoomedView = parseViewBox(await canvas.getAttribute("viewBox"));
  expect(zoomedView.width).toBeLessThan(initialView.width);

  for (let step = 0; step < 7; step += 1) {
    await zoomOutButton.click();
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

  await fitViewButton.click();
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

  await fitViewButton.click();

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
  await expect(page.getByTestId("output-status")).toContainText("Selected 2 nodes.");
  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N2",
  );

  await page.keyboard.press("m");

  await expect(page.getByTestId("output-status")).toContainText(
    "Merged 2 nodes into N2",
  );
  await expect(page.getByTestId("node-0")).toHaveCount(0);
  await expect(page.getByTestId("node-1")).toBeVisible();
  await expect(page.getByTestId("edge-0")).toHaveCount(0);
  await expect(page.getByTestId("edge-1")).toHaveCount(1);

  await clickBuildMatrices(page);

  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);

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
  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N2",
  );
  await expect(mergeButton).toBeEnabled();
  await expect(page.getByTestId("output-status")).toContainText("Selected 2 nodes.");

  await canvas.click({ position: { x: 760, y: 440 } });
  await expect(page.getByTestId("merge-target-summary")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Selection cleared.",
  );

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await node0.click();
  await expect(node0).toHaveClass(/selected/);
  await expect(page.getByTestId("output-status")).toContainText("Selected 1 node.");

  await node1.click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N2",
  );
  await expect(page.getByTestId("output-status")).toContainText("Selected 2 nodes.");

  await node0.click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("merge-target-summary")).toHaveCount(0);
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

  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N2",
  );
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
  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N2",
  );
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
  await expect(page.getByTestId("node-matrix-label-2")).toContainText("2");
  await expect(page.getByTestId("node-matrix-label-3")).toContainText("3");
  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N4",
  );

  const node3Center = await parseSvgCircleCenter(page.getByTestId("node-3"));
  const pastedGround = await parseSvgLine(page.getByTestId("edge-3"));
  expect(Math.abs(pastedGround.x1 - node3Center.x)).toBeLessThan(1);
  expect(Math.abs(pastedGround.y1 - node3Center.y)).toBeLessThan(1);
  expect(Math.abs(pastedGround.x2 - node3Center.x)).toBeLessThan(1);
  expect(Math.abs(pastedGround.y2 - node3Center.y - 104)).toBeLessThan(1);

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 4 x 4");
  await expectRawMatrixEntriesHidden(page);
});
