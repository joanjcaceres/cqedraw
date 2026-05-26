import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  clickBuildMatrices,
  expectRawMatrixEntriesHidden,
  setRangeInputValue,
  expectAnalysisResultsRightOfControls,
  expectFrequencyPlotFitsInOutputPanel,
  expectAnalysisResultsUseDrawerScroll,
  expectFrequencyChartInteractions,
  expectChartRegionZoom,
  selectAnalysisPlotTab,
} from "./helpers";

test("plots Josephson phase ZPF for JJ sweeps", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 240, y: 220 } });

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("cap-input").fill("Cj");
  await page.getByTestId("jj-ind-input").fill("Lj");

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 1 x 1");
  await page.getByLabel("Value for Cj").fill("80e-15");
  await page.getByLabel("Value for Lj").fill("8e-9");

  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible({
    timeout: 60_000,
  });
  const frequencyModeTicks = await page
    .getByTestId("frequency-mode-plot")
    .locator('[data-axis="x"]')
    .allTextContents();
  expect(frequencyModeTicks.length).toBeGreaterThan(0);
  expect(frequencyModeTicks.every((tick) => /^-?\d+$/.test(tick.trim()))).toBe(
    true,
  );
  await expect(page.getByTestId("analysis-plot-tabs")).toBeVisible();
  await expect(page.getByTestId("zpf-mode-plot")).toHaveCount(0);
  await selectAnalysisPlotTab(page, "Phase ZPF");
  await expect(page.getByTestId("zpf-mode-plot")).toBeVisible();
  await expect(page.getByTestId("zpf-mode-plot-zero-line")).toHaveCount(1);
  await expect(page.getByTestId("zpf-mode-plot-signed-values")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("zpf-mode-plot-absolute-values").click();
  await expect(page.getByTestId("zpf-mode-plot-absolute-values")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectChartRegionZoom(page, "zpf-mode-plot");

  await page.getByLabel("Sweep Lj").check();
  await expect(page.getByLabel("Value for Lj")).toHaveValue("Previous: 8e-9");
  await page.getByLabel("Sweep scale for Lj").selectOption("log");
  await expect(page.getByText("Points/decade")).toBeVisible();
  await page.getByLabel("Sweep min for Lj").fill("1e-9");
  await page.getByLabel("Sweep max for Lj").fill("1e-7");
  await page.getByLabel("Sweep step for Lj").fill("2");
  await expect(page.getByTestId("sweep-sample-slider-Lj")).toBeVisible();
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 5 / 5",
    { timeout: 60_000 },
  );
  await setRangeInputValue(page.getByTestId("sweep-sample-slider-Lj"), "1");
  await expect(page.getByLabel("Selected sweep value for Lj")).toHaveValue(
    "3.1623e-9",
  );
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 5 / 5",
    { timeout: 60_000 },
  );
  await page.getByLabel("Selected sweep value for Lj").fill("7e-9");
  await page.getByLabel("Selected sweep value for Lj").press("Enter");
  await expect(page.getByLabel("Selected sweep value for Lj")).toHaveValue(
    "7.0000e-9",
  );
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 5 / 5",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("zpf-mode-plot")).toBeVisible({
    timeout: 60_000,
  });
  await selectAnalysisPlotTab(page, "Frequencies");
  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible();
  await selectAnalysisPlotTab(page, "Phase ZPF");
  await expect(page.getByTestId("zpf-mode-plot")).toBeVisible();
  await expectAnalysisResultsRightOfControls(page);
  await expect(page.getByTestId("sweep-frequency-plot")).toHaveCount(0);
});

test("accepts Ec and Ej values for modal analysis", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("canvas");
  await page.getByRole("button", { name: "Node" }).click();
  await canvas.click({ position: { x: 240, y: 220 } });

  await page.getByRole("button", { name: "Ground" }).click();
  await page.getByTestId("node-0").click();
  await page.getByTestId("cap-input").fill("Cj");
  await page.getByTestId("jj-ind-input").fill("Lj");

  await clickBuildMatrices(page);
  await page
    .getByRole("group", { name: "Input representation for Cj" })
    .getByRole("button", { name: "E_C" })
    .click();
  await page
    .getByRole("group", { name: "Input representation for Lj" })
    .getByRole("button", { name: "E_J" })
    .click();
  await expect(page.getByLabel("Value for Cj")).toHaveAttribute(
    "placeholder",
    "E_C/h in GHz",
  );
  await expect(page.getByLabel("Value for Lj")).toHaveAttribute(
    "placeholder",
    "E_J/h in GHz",
  );

  await page.getByLabel("Value for Cj").fill("0.25");
  await page.getByLabel("Value for Lj").fill("20");
  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible({
    timeout: 60_000,
  });
  await selectAnalysisPlotTab(page, "Phase ZPF");
  await expect(page.getByTestId("zpf-mode-plot")).toBeVisible();
});

test("uses a trace selector for many Josephson phase ZPF traces", async ({
  page,
}) => {
  await page.goto("/");

  await page.locator('input[type="file"]').setInputFiles({
    name: "many-jj-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        state: {
          edge_counter: 7,
          node_counter: 7,
          nodes: Array.from({ length: 7 }, (_, index) => ({
            identifier: index,
            name: `N${index + 1}`,
            x: 180 + index * 80,
            y: 220,
          })),
          edges: Array.from({ length: 7 }, (_, index) => ({
            identifier: index,
            nodes: [index, -1],
            capacitance_text: "C",
            inductance_text: null,
            josephson_inductance_text: "L",
            josephson_phase_sign: 1,
            is_ground: true,
            ground_offset_x: 0,
            ground_offset_y: 104,
          })),
        },
      }),
    ),
  });

  await clickBuildMatrices(page);
  await expect(page.getByTestId("output-status")).toContainText("Generated 7 x 7");
  await page.getByLabel("Value for C").fill("80e-15");
  await page.getByLabel("Value for L").fill("8e-9");

  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible({
    timeout: 60_000,
  });
  await selectAnalysisPlotTab(page, "Phase ZPF");
  const zpfChart = page.getByTestId("zpf-mode-plot");
  await expect(zpfChart).toBeVisible({ timeout: 60_000 });
  const modalTable = page.getByTestId("modal-analysis");
  await expect(modalTable.locator("summary")).toContainText("7 modes");
  await expect(modalTable.locator("summary")).toContainText("7 JJ columns");
  await expect
    .poll(() =>
      modalTable.evaluate((element) => (element as HTMLDetailsElement).open),
    )
    .toBe(false);
  await modalTable.locator("summary").click();
  await expect
    .poll(() =>
      modalTable.evaluate((element) => (element as HTMLDetailsElement).open),
    )
    .toBe(true);
  const traceSelect = page.getByTestId("zpf-mode-plot-trace-select");
  await expect(traceSelect).toBeVisible();
  await expect(traceSelect).not.toHaveValue("all");
  await expect(zpfChart.locator(".analysis-chart-line")).toHaveCount(1);

  await traceSelect.selectOption("edge_1");
  await page.getByTestId("zpf-mode-plot-add-trace").click();
  await expect(zpfChart.locator(".analysis-chart-line")).toHaveCount(2);

  await page.getByTestId("zpf-mode-plot-absolute-values").click();
  await expect(zpfChart.locator(".analysis-chart-line")).toHaveCount(2);

  await page.getByTestId("zpf-mode-plot-all-traces").click();
  await expect(zpfChart.locator(".analysis-chart-line")).toHaveCount(7);
});

test("keeps large Josephson sweep charts mounted", async ({ page }) => {
  await page.goto("/");

  const nodeCount = 100;
  await page.locator('input[type="file"]').setInputFiles({
    name: "large-jj-sweep-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        state: {
          edge_counter: nodeCount,
          node_counter: nodeCount,
          nodes: Array.from({ length: nodeCount }, (_, index) => ({
            identifier: index,
            name: `N${index + 1}`,
            x: 180 + index * 80,
            y: 220,
          })),
          edges: Array.from({ length: nodeCount }, (_, index) => ({
            identifier: index,
            nodes: [index, -1],
            capacitance_text: "C",
            inductance_text: null,
            josephson_inductance_text: "L",
            josephson_phase_sign: 1,
            is_ground: true,
            ground_offset_x: 0,
            ground_offset_y: 104,
          })),
        },
      }),
    ),
  });

  await clickBuildMatrices(page);
  await page.getByRole("textbox", { exact: true, name: "Value for C" }).fill("25e-15");
  await page.getByRole("textbox", { exact: true, name: "Value for L" }).fill("3e-9");
  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByLabel("Sweep C").check();
  await page.getByLabel("Sweep min for C").fill("1e-15");
  await page.getByLabel("Sweep max for C").fill("5e-15");
  await page.getByLabel("Sweep step for C").fill("1e-15");
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 5 / 5",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible();
  await selectAnalysisPlotTab(page, "Phase ZPF");
  const zpfChart = page.getByTestId("zpf-mode-plot");
  await expect(zpfChart).toBeVisible();
  const chartBoxBeforeTable = await zpfChart.boundingBox();
  if (!chartBoxBeforeTable) {
    throw new Error("Expected phase ZPF chart box before opening modal table.");
  }
  const modalTable = page.getByTestId("modal-analysis");
  await modalTable.locator("summary").click();
  await expect
    .poll(() =>
      modalTable.evaluate((element) => (element as HTMLDetailsElement).open),
    )
    .toBe(true);
  const chartBoxAfterTable = await zpfChart.boundingBox();
  if (!chartBoxAfterTable) {
    throw new Error("Expected phase ZPF chart box after opening modal table.");
  }
  expect(chartBoxAfterTable.width).toBeGreaterThanOrEqual(
    chartBoxBeforeTable.width - 2,
  );
  expect(chartBoxAfterTable.width).toBeLessThanOrEqual(
    chartBoxBeforeTable.width + 2,
  );
  const tableWidths = await modalTable
    .locator(".modal-analysis-table-wrap")
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  expect(tableWidths.scrollWidth).toBeGreaterThan(tableWidths.clientWidth);
  await expect(page.getByText("cQEDraw")).toBeVisible();
});

test("creates a small circuit and copies generated C and L_inv matrices", async ({
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
  await clickBuildMatrices(page);

  await expect(page.getByTestId("output-status")).toContainText("Generated 2 x 2");
  await expectRawMatrixEntriesHidden(page);
  await expect(page.getByTestId("snippet-output")).toHaveCount(0);
  await expect(page.getByTestId("parameter-required-message")).toContainText(
    "Enter values for: C12, Cg, L12_inv, Lg_inv",
  );
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run sweep" })).toHaveCount(0);
  await expect(page.getByTestId("frequency-mode-plot-placeholder")).toBeVisible();
  await expect(page.getByTestId("frequency-mode-plot")).toHaveCount(0);
  await expectAnalysisResultsRightOfControls(page);

  await page.getByLabel("Value for C12").fill("2e-15");
  await page.getByLabel("Value for Cg").fill("5e-15");
  await page.getByLabel("Value for L12_inv").fill("1e9");
  await page.getByLabel("Value for Lg_inv").fill("2e9");
  await expect(page.getByTestId("parameter-required-message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run sweep" })).toHaveCount(0);
  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("frequency-mode-plot-placeholder")).toHaveCount(0);
  await expect(page.getByTestId("frequency-mode-plot-zero-line")).toHaveCount(1);
  await expectFrequencyPlotFitsInOutputPanel(page);
  await expectAnalysisResultsUseDrawerScroll(page);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  const analysisExportButton = page
    .getByTestId("modal-analysis")
    .getByRole("button", { name: "Export CSV" });
  await expect(analysisExportButton).toBeEnabled();

  await page.getByLabel("Sweep C12").check();
  await expect(page.getByLabel("Value for C12")).toHaveValue("Previous: 2e-15");
  await page.getByLabel("Sweep min for C12").fill("1e-15");
  await page.getByLabel("Sweep max for C12").fill("3e-15");
  await page.getByLabel("Sweep step for C12").fill("2e-15");
  await page.getByLabel("Sweep L12_inv").check();
  await page.getByLabel("Sweep min for L12_inv").fill("1e9");
  await page.getByLabel("Sweep max for L12_inv").fill("2e9");
  await page.getByLabel("Sweep step for L12_inv").fill("1e9");
  await expect(page.getByRole("button", { name: "Run sweep" })).toHaveCount(0);
  await expect(page.getByTestId("sweep-sample-slider-C12")).toBeVisible();
  await expect(page.getByTestId("sweep-sample-slider-L12_inv")).toBeVisible();
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 4 / 4",
    { timeout: 60_000 },
  );
  await setRangeInputValue(page.getByTestId("sweep-sample-slider-C12"), "1");
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 4 / 4",
    { timeout: 60_000 },
  );
  await setRangeInputValue(page.getByTestId("sweep-sample-slider-L12_inv"), "1");
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 4 / 4",
    { timeout: 60_000 },
  );
  await setRangeInputValue(page.getByTestId("sweep-sample-slider-C12"), "0");
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points: 4 / 4",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("frequency-mode-plot")).toBeVisible({
    timeout: 60_000,
  });
  await expectAnalysisResultsRightOfControls(page);
  await expectFrequencyChartInteractions(page);
  await expect(page.getByTestId("sweep-frequency-plot")).toHaveCount(0);

  await page.getByLabel("Sweep max for C12").fill("10e-15");
  await page.getByLabel("Sweep step for C12").fill("1e-15");
  await page.getByLabel("Sweep max for L12_inv").fill("20e9");
  await page.getByLabel("Sweep step for L12_inv").fill("1e9");
  await expect(page.getByTestId("sweep-validation-message")).toHaveCount(0);
  await expect(page.getByTestId("sweep-point-count")).toContainText(
    "200 slider combinations",
  );
  await expect(page.getByTestId("sweep-point-count")).toContainText(
    "up to 101 nearby points",
  );
  await expect(page.getByTestId("sweep-result-summary")).toContainText(
    "Cached points:",
    { timeout: 60_000 },
  );
  await expect(page.getByText("Sweep is limited to 101 points")).toHaveCount(0);
  const analysisBeforeLargeSweepMove = await page
    .getByTestId("modal-analysis")
    .innerText();
  await setRangeInputValue(page.getByTestId("sweep-sample-slider-C12"), "9");
  await expect.poll(async () => page.getByTestId("modal-analysis").innerText(), {
    timeout: 60_000,
  }).not.toBe(analysisBeforeLargeSweepMove);

  const exportPromise = page.waitForEvent("download");
  await analysisExportButton.click();
  const exported = await exportPromise;
  expect(exported.suggestedFilename()).toBe("cqedraw-analysis-table.csv");
  const exportedPath = await exported.path();
  if (!exportedPath) {
    throw new Error("Exported CSV download path is unavailable.");
  }
  const exportedCsv = await readFile(exportedPath, "utf8");
  const csvRows = exportedCsv.trim().split(/\r?\n/);
  expect(csvRows).toHaveLength(3);
  expect(csvRows[0]).toBe("frequency_ghz");
  expect(Number(csvRows[1])).toBeGreaterThan(0);
  expect(Number(csvRows[2])).toBeGreaterThan(0);
  await expect(page.getByTestId("output-status")).toContainText(
    "Exported analysis table CSV.",
  );

  await page.getByRole("button", { exact: true, name: "Copy matrices" }).click();
  await expect(page.getByTestId("output-status")).toContainText(
    "Copied matrices to clipboard. Paste them into Python or a notebook.",
  );
  await expect(page.getByTestId("output-status")).toHaveClass(/status-line-success/);
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toContainText("Copied");
  const copiedSnippet = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedSnippet).toContain("def circuit_matrices");
  expect(copiedSnippet).toContain("def capacitance_matrix");
  expect(copiedSnippet).toContain("def inverse_inductance_matrix");
  expect(copiedSnippet).toContain("C12");
  expect(copiedSnippet).toContain("Cg");
  expect(copiedSnippet).toContain("L12_inv");
  expect(copiedSnippet).toContain("Lg_inv");
  expect(copiedSnippet).toContain("def josephson_branches");
  expect(copiedSnippet).not.toContain("_func");
});
