import { Buffer } from "node:buffer";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  clickBuildMatrices,
  expectAnalysisResultsRightOfControls,
} from "./helpers";

const MANY_PARAMETER_COUNT = 60;
const MANY_PARAMETER_GENERATION_LIMIT_MS = 60_000;

test("keeps many symbolic parameter controls contained and usable", async ({
  page,
}) => {
  await page.goto("/");
  await loadManyParameterProject(page, MANY_PARAMETER_COUNT);

  const generationStartedAt = Date.now();
  await clickBuildMatrices(page);
  expect(Date.now() - generationStartedAt).toBeLessThan(
    MANY_PARAMETER_GENERATION_LIMIT_MS,
  );
  await expect(page.getByTestId("output-status")).toContainText(
    `Generated ${MANY_PARAMETER_COUNT} x ${MANY_PARAMETER_COUNT}`,
  );

  const parameterInputs = page.locator('input[aria-label^="Value for C"]');
  await expect(parameterInputs).toHaveCount(MANY_PARAMETER_COUNT);
  await expect(page.getByLabel("Value for C0", { exact: true })).toBeVisible();
  await page.getByLabel("Value for C0", { exact: true }).fill("1e-15");

  const parameterGrid = page.getByTestId("parameter-values");
  const gridMetrics = await parameterGrid.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(gridMetrics.overflowY).toBe("auto");
  expect(gridMetrics.scrollHeight).toBeGreaterThan(gridMetrics.clientHeight);

  await parameterGrid.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const finalInput = page.getByLabel(`Value for C${MANY_PARAMETER_COUNT - 1}`, {
    exact: true,
  });
  await expect(finalInput).toBeVisible();
  await finalInput.fill("2e-15");

  const panelBox = await page.getByTestId("output-panel").boundingBox();
  const gridBox = await parameterGrid.boundingBox();
  if (!panelBox || !gridBox) {
    throw new Error("Expected output panel and parameter grid boxes.");
  }
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Expected viewport size.");
  }
  expect(gridBox.y + gridBox.height).toBeLessThanOrEqual(viewport.height - 12);
  expect(gridBox.height).toBeLessThan(panelBox.height * 0.72);
  await expectAnalysisResultsRightOfControls(page);
});

async function loadManyParameterProject(page: Page, count: number) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "many-symbolic-parameters.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        state: {
          edge_counter: count,
          node_counter: count,
          nodes: Array.from({ length: count }, (_, index) => ({
            identifier: index,
            name: `N${index + 1}`,
            x: 180 + index * 70,
            y: 220,
          })),
          edges: Array.from({ length: count }, (_, index) => ({
            capacitance_expr: `C${index}`,
            capacitance_text: `C${index}`,
            ground_offset_x: 0,
            ground_offset_y: 104,
            identifier: index,
            inductance_expr: null,
            inductance_text: null,
            is_ground: true,
            josephson_inductance_expr: null,
            josephson_inductance_text: null,
            josephson_phase_sign: 1,
            l_inverse_expr: null,
            nodes: [index, -1],
          })),
        },
      }),
    ),
  });
}
