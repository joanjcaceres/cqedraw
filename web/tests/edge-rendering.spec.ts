import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import {
  clickBuildMatrices,
  expectRawMatrixEntriesHidden,
  closeOutputDrawer,
  symbolCoordinatesStayWithinHalfLength,
  expectCapacitorLeftOfInductor,
  capacitorPlateHeight,
  parseSvgLine,
  expectInlineEditorCenteredOnEdge,
  parseSvgRotation,
} from "./helpers";

test("edits newly created edge and ground values inline", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();

  const inlineEditor = page.getByTestId("inline-edge-value-editor");
  const inlineCapInput = page.getByTestId("cap-input");
  const inlineIndInput = page.getByTestId("ind-input");
  await expect(inlineEditor).toBeVisible();
  await expect(inlineCapInput).toBeFocused();
  await expectInlineEditorCenteredOnEdge(page, "edge-0", inlineEditor);

  await inlineCapInput.fill("Cinline");
  await inlineIndInput.fill("1/Linline_inv");
  await expect(page.getByTestId("cap-input")).toHaveValue("Cinline");
  await expect(page.getByTestId("ind-input")).toHaveValue("1/Linline_inv");

  await page.keyboard.press("Enter");
  await expect(inlineEditor).toHaveCount(0);
  await expect(page.getByTestId("edge-0")).toHaveCount(1);

  await page.getByTestId("edge-0").click({ force: true });
  await expect(inlineEditor).toBeVisible();
  await expect(inlineCapInput).toBeFocused();
  await expect(inlineCapInput).toHaveValue("Cinline");
  await expect(inlineIndInput).toHaveValue("1/Linline_inv");
  await inlineCapInput.fill("Cclicked");
  await inlineIndInput.fill("1/Lclicked_inv");
  await expect(page.getByTestId("cap-input")).toHaveValue("Cclicked");
  await expect(page.getByTestId("ind-input")).toHaveValue("1/Lclicked_inv");

  await page.keyboard.press("Enter");
  await expect(inlineEditor).toHaveCount(0);

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  await expect(inlineEditor).toBeVisible();
  await expect(inlineCapInput).toBeFocused();

  await inlineCapInput.fill("Cg");
  await inlineIndInput.fill("1/Lg_inv");
  await expect(page.getByTestId("cap-input")).toHaveValue("Cg");
  await expect(page.getByTestId("ind-input")).toHaveValue("1/Lg_inv");

  await page.keyboard.press("Escape");
  await expect(inlineEditor).toHaveCount(0);
  await expect(page.getByTestId("edge-1")).toHaveCount(1);

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);
});

test("dismisses inline edge values by clicking away without deleting the edge", async ({
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
  await expect(page.getByTestId("inline-edge-value-editor")).toBeVisible();

  await canvas.click({ position: { x: 720, y: 460 } });
  await expect(page.getByTestId("inline-edge-value-editor")).toHaveCount(0);
  await expect(page.getByTestId("edge-0")).toHaveCount(1);
  await expect(page.getByTestId("cap-input")).toHaveCount(0);
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
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inline-edge-value-editor")).toHaveCount(0);
  const capLabelBox = await page.getByTestId("edge-value-cap-0").boundingBox();
  if (!capLabelBox) {
    throw new Error("Capacitance label box is unavailable.");
  }
  await page.mouse.click(
    capLabelBox.x + capLabelBox.width / 2,
    capLabelBox.y + capLabelBox.height / 2,
  );
  await expect(page.getByTestId("inline-edge-value-editor")).toBeVisible();
  await expect(page.getByTestId("cap-input")).toHaveValue("C12");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inline-edge-value-editor")).toHaveCount(0);

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

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);

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

test("keeps parallel component lanes stable while dragging near vertical", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 180 } });
  await canvas.click({ position: { x: 130, y: 380 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("C");
  await page.getByTestId("ind-input").fill("L");

  const symbol = page.getByTestId("edge-symbol-0");
  await expect(symbol).toHaveAttribute("data-component-kind", "parallel-lc");
  await expectCapacitorLeftOfInductor(symbol);

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const canvasBox = await canvas.boundingBox();
  const nodeBox = await page.getByTestId("node-1").boundingBox();
  if (!canvasBox || !nodeBox) {
    throw new Error("Expected canvas and node boxes to be available.");
  }

  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 190, canvasBox.y + 380);
  await page.mouse.up();

  await expectCapacitorLeftOfInductor(symbol);
});

test("exports Josephson junction branch metadata and phase direction", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4173",
  });
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 220 } });
  await canvas.click({ position: { x: 330, y: 220 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("cap-input").fill("Cj");
  await page.getByTestId("ind-input").fill("Lgeom");
  await page.getByTestId("jj-ind-input").fill("Lj");
  await expect(page.getByTestId("edge-symbol-0")).toHaveAttribute(
    "data-component-kind",
    "parallel-lcj",
  );
  await expect(page.getByTestId("edge-value-jj-0")).toContainText("LJ=Lj");
  await expect(page.getByTestId("jj-phase-label")).toContainText("Phase: 1 - 0");

  await page.getByRole("button", { name: "Reverse" }).click();
  await expect(page.getByTestId("jj-phase-label")).toContainText("Phase: 0 - 1");

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-1").click();
  await page.getByTestId("jj-ind-input").fill("Lground_j");
  await expect(page.getByTestId("edge-symbol-1")).toHaveAttribute(
    "data-component-kind",
    "josephson",
  );

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);
  await expect(page.getByTestId("jj-branches")).toContainText(
    "2 Josephson branches included in the copied Python snippet.",
  );
  await expect(page.getByTestId("matrix-nodes")).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: "Copy matrices" }).click();
  const copiedSnippet = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedSnippet).toContain("Lgeom");
  expect(copiedSnippet).toContain("Lj");
  expect(copiedSnippet).toContain("Lground_j");
  expect(copiedSnippet).toContain("NODE_INDEX_MAP");
  expect(copiedSnippet).toContain('"matrix_index": 0');
  expect(copiedSnippet).toContain('"project_node_id": 0');
  expect(copiedSnippet).toContain("JOSEPHSON_BRANCHES");
  expect(copiedSnippet).toContain("def josephson_branches");
  expect(copiedSnippet).toContain('"phase_positive_index": 0');
  expect(copiedSnippet).toContain('"phase_negative_index": 1');

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Saved project download path is unavailable.");
  }
  const savedProject = JSON.parse(await readFile(downloadPath, "utf8"));
  expect(savedProject.version).toBe(2);
  expect(savedProject.state.edges[0]).toMatchObject({
    josephson_inductance_text: "Lj",
    josephson_phase_sign: -1,
  });
  expect(savedProject.state.edges[1]).toMatchObject({
    josephson_inductance_text: "Lground_j",
    josephson_phase_sign: 1,
  });

  await page.locator('input[type="file"]').setInputFiles({
    name: "jj-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(savedProject)),
  });
  await page.getByTestId("edge-0").click({ force: true });
  await expect(page.getByTestId("jj-ind-input")).toHaveValue("Lj");
  await expect(page.getByTestId("jj-phase-label")).toContainText("Phase: 0 - 1");
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

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);
  await closeOutputDrawer(page);

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

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);

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

test("keeps existing ground when Ground mode clicks a grounded node", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 220, y: 220 } });

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-0").dblclick();
  await expect(page.getByTestId("edge-0")).toHaveCount(1);
  await expect(page.getByTestId("output-status")).toContainText(
    "Added ground connection.",
  );
  await page.getByTestId("cap-input").fill("Cg");
  await page.getByTestId("ind-input").fill("1/Lg_inv");

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  const groundEdge = page.getByTestId("edge-0");
  const beforeMove = await parseSvgLine(groundEdge);
  const groundBox = await page.getByTestId("ground-symbol-0").boundingBox();
  if (!groundBox) {
    throw new Error("Ground symbol box is unavailable.");
  }
  await page.mouse.move(
    groundBox.x + groundBox.width / 2,
    groundBox.y + groundBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    groundBox.x + groundBox.width / 2 + 80,
    groundBox.y + groundBox.height / 2 - 45,
  );
  await page.mouse.up();
  const afterMove = await parseSvgLine(groundEdge);
  expect(afterMove.x2 - beforeMove.x2).toBeGreaterThan(40);
  expect(afterMove.y2 - beforeMove.y2).toBeLessThan(-20);

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-0").click();

  await expect(page.getByTestId("edge-0")).toHaveCount(1);
  await expect(page.getByTestId("ground-symbol-0")).toHaveClass(/selected/);
  await expect(page.getByTestId("output-status")).toContainText(
    "Selected existing ground connection.",
  );
  await expect(page.getByTestId("cap-input")).toHaveValue("Cg");
  await expect(page.getByTestId("ind-input")).toHaveValue("1/Lg_inv");
  const afterSecondGroundClick = await parseSvgLine(groundEdge);
  expect(afterSecondGroundClick.x2).toBeCloseTo(afterMove.x2, 3);
  expect(afterSecondGroundClick.y2).toBeCloseTo(afterMove.y2, 3);

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 1 x 1");
  await expectRawMatrixEntriesHidden(page);

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("edge-0")).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Deleted ground connection.",
  );
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
  await clickBuildMatrices(page);

  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);
});
