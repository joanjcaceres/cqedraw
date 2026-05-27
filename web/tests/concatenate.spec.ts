import { expect, test } from "./fixtures";
import {
  clickBuildMatrices,
  expectRawMatrixEntriesHidden,
  parseSvgCircleCenter,
  parseSvgLine,
} from "./helpers";

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
  await expect(page.getByTestId("concatenate-pair-row-0")).toContainText("Pair 1");
  await expect(page.getByTestId("concatenate-preview-bridge-0")).toHaveCount(1);
  const dialogBoxBeforeDrag = await dialog.boundingBox();
  const dialogHeadingBox = await dialog
    .getByRole("heading", { name: "Concatenate selection" })
    .boundingBox();
  if (!dialogBoxBeforeDrag || !dialogHeadingBox) {
    throw new Error("Concatenate dialog boxes are unavailable.");
  }
  await page.mouse.move(
    dialogHeadingBox.x + dialogHeadingBox.width / 2,
    dialogHeadingBox.y + dialogHeadingBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    dialogHeadingBox.x + dialogHeadingBox.width / 2 - 120,
    dialogHeadingBox.y + dialogHeadingBox.height / 2,
  );
  await page.mouse.up();
  const dialogBoxAfterDrag = await dialog.boundingBox();
  if (!dialogBoxAfterDrag) {
    throw new Error("Concatenate dialog box after drag is unavailable.");
  }
  expect(dialogBoxAfterDrag.x).toBeLessThan(dialogBoxBeforeDrag.x - 80);
  await page.getByLabel("Pairing rows").fill("");
  await dialog.getByRole("button", { name: "Concatenate" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Enter a pairing row count from 0 to 1.",
  );
  await page.getByLabel("Pairing rows").fill("1");
  await page.getByLabel("Number of repeats").fill("2");
  await dialog.getByRole("button", { name: "Concatenate" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Concatenated 2 repeats; added 2 node(s).",
  );
  await expect(page.getByTestId("node-2")).toBeVisible();
  await expect(page.getByTestId("node-3")).toBeVisible();
  await expect(page.getByTestId("edge-4")).toHaveCount(1);
  await expect(page.getByTestId("node-matrix-label-2")).toContainText("2");
  await expect(page.getByTestId("node-matrix-label-3")).toContainText("3");
  await expect(page.getByTestId("merge-target-summary")).toContainText(
    "Merge keeps N4",
  );

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 4 x 4");
  await expectRawMatrixEntriesHidden(page);
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
  await expect(page.getByTestId("concatenate-pair-row-0")).toContainText("Pair 1");
  await expect(page.getByTestId("concatenate-pair-row-1")).toContainText("Pair 2");
  await expect(page.getByTestId("concatenate-preview-bridge-0")).toHaveCount(1);
  await expect(page.getByTestId("concatenate-preview-bridge-1")).toHaveCount(1);
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

test("expands concatenate pairings for irregular selected blocks", async ({
  page,
}) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 160, y: 180 } });
  await canvas.click({ position: { x: 210, y: 300 } });
  await canvas.click({ position: { x: 330, y: 300 } });
  await canvas.click({ position: { x: 380, y: 180 } });

  await page.getByRole("button", { name: "Edge" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-3").click();
  await page.getByTestId("cap-input").fill("Ct");
  await page.getByTestId("node-1").click();
  await page.getByTestId("node-2").click();
  await page.getByTestId("cap-input").fill("Cb");

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click({ modifiers: ["Shift"] });
  await page.getByTestId("node-2").click({ modifiers: ["Shift"] });
  await page.getByTestId("node-3").click({ modifiers: ["Shift"] });

  await page.getByRole("button", { name: "Concatenate" }).click();
  const dialog = page.getByRole("dialog", { name: "Concatenate selection" });
  await expect(page.getByTestId("concatenate-port-input")).toHaveValue("1");
  await expect(page.getByTestId("concatenate-pair-row-1")).toHaveCount(0);
  await expect(page.getByTestId("concatenate-preview-bridge-0")).toHaveCount(1);

  await page.getByLabel("Pairing rows").fill("2");
  await expect(page.getByTestId("concatenate-pair-row-1")).toContainText("Pair 2");
  await expect(page.getByTestId("concatenate-preview-bridge-1")).toHaveCount(1);
  await page.getByLabel("Pair 2 left port").selectOption({ label: "N4" });
  await expect(dialog.getByRole("alert")).toContainText(
    "Each enabled pair needs unique nodes across left and right ports.",
  );
  await expect(page.getByTestId("concatenate-preview-bridge-0")).toHaveCount(0);
  await page.getByLabel("Pair 2 left port").selectOption({ label: "N2" });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("concatenate-preview-bridge-1")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Concatenate" }).click();

  await expect(page.getByTestId("output-status")).toContainText(
    "Concatenated 1 repeat; added 2 node(s).",
  );
  await expect(page.getByTestId("node-4")).toBeVisible();
  await expect(page.getByTestId("node-5")).toBeVisible();

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 6 x 6");
  await expectRawMatrixEntriesHidden(page);
});

test("disables concatenate pairings to duplicate the selected block", async ({
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

  await page.getByRole("button", { exact: true, name: "Select" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("node-1").click({ modifiers: ["Shift"] });

  await page.getByRole("button", { name: "Concatenate" }).click();
  const dialog = page.getByRole("dialog", { name: "Concatenate selection" });
  await expect(page.getByTestId("concatenate-preview-bridge-0")).toHaveCount(1);
  await dialog.getByLabel("Use pair 1").uncheck();
  await expect(page.getByTestId("concatenate-preview-bridge-0")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Concatenate" }).click();

  await expect(page.getByTestId("output-status")).toContainText(
    "Concatenated 1 repeat; added 2 node(s).",
  );
  await expect(page.getByTestId("node-2")).toBeVisible();
  await expect(page.getByTestId("node-3")).toBeVisible();

  const firstRepeatNode = await parseSvgCircleCenter(page.getByTestId("node-2"));
  const secondRepeatNode = await parseSvgCircleCenter(page.getByTestId("node-3"));
  const duplicatedEdge = await parseSvgLine(page.getByTestId("edge-1"));
  expect(Math.abs(duplicatedEdge.x1 - firstRepeatNode.x)).toBeLessThan(1);
  expect(Math.abs(duplicatedEdge.y1 - firstRepeatNode.y)).toBeLessThan(1);
  expect(Math.abs(duplicatedEdge.x2 - secondRepeatNode.x)).toBeLessThan(1);
  expect(Math.abs(duplicatedEdge.y2 - secondRepeatNode.y)).toBeLessThan(1);
});
