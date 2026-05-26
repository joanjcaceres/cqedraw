import { expect, type Locator, type Page } from "@playwright/test";

export const CANVAS_WIDTH = 900;
export const OLD_MAX_VIEW_WIDTH = CANVAS_WIDTH * 3;

export async function openOutputDrawer(page: Page) {
  if ((await page.getByTestId("output-drawer").count()) === 0) {
    await page.getByRole("button", { exact: true, name: "Output" }).click();
  }
  await expect(page.getByTestId("output-drawer")).toBeVisible();
}

export async function dismissTutorialPromptIfVisible(page: Page) {
  const prompt = page.getByTestId("tutorial-prompt");
  if ((await prompt.count()) === 0 || !(await prompt.isVisible())) {
    return;
  }
  await prompt.getByRole("button", { name: "Skip" }).click();
  await expect(prompt).toBeHidden();
}

export async function clickBuildMatrices(page: Page) {
  await openOutputDrawer(page);
  await expect(page.getByTestId("output-status")).toContainText(/Generated \d+ x \d+/, {
    timeout: 60_000,
  });
}

export async function expectRawMatrixEntriesHidden(page: Page) {
  await expect(page.getByTestId("c-entries")).toHaveCount(0);
  await expect(page.getByTestId("l-entries")).toHaveCount(0);
}

export async function setRangeInputValue(locator: Locator, value: string) {
  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

export async function expectAnalysisResultsRightOfControls(page: Page) {
  const controlsBox = await page.getByTestId("analysis-parameter-panel").boundingBox();
  const resultsBox = await page.getByTestId("analysis-results").boundingBox();
  if (!controlsBox || !resultsBox) {
    throw new Error("Expected analysis controls and results boxes to be available.");
  }
  expect(resultsBox.x).toBeGreaterThan(controlsBox.x + controlsBox.width * 0.85);
  expect(resultsBox.y).toBeLessThanOrEqual(controlsBox.y + 8);
}

export async function expectFrequencyPlotFitsInOutputPanel(page: Page) {
  const panelBox = await page.getByTestId("output-panel").boundingBox();
  const plotBox = await page.getByTestId("frequency-mode-plot").boundingBox();
  if (!panelBox || !plotBox) {
    throw new Error("Expected output panel and frequency plot boxes to be available.");
  }
  expect(plotBox.y).toBeGreaterThanOrEqual(panelBox.y - 1);
  expect(plotBox.y + plotBox.height).toBeLessThanOrEqual(
    panelBox.y + panelBox.height + 1,
  );
}

export async function expectAnalysisResultsUseDrawerScroll(page: Page) {
  await expect
    .poll(() =>
      page
        .getByTestId("analysis-results")
        .evaluate((element) => getComputedStyle(element).overflowY),
    )
    .toBe("visible");
}

export async function expectFrequencyChartInteractions(page: Page) {
  const chart = page.getByTestId("frequency-mode-plot");
  const fixedAxisButton = page.getByTestId("frequency-mode-plot-axis-fixed");
  const manualAxisButton = page.getByTestId("frequency-mode-plot-axis-manual");
  const resetButton = page.getByTestId("frequency-mode-plot-reset-view");

  await expect(fixedAxisButton).toBeEnabled();
  await fixedAxisButton.click();
  await expect(fixedAxisButton).toHaveAttribute("aria-pressed", "true");

  await manualAxisButton.click();
  await expect(manualAxisButton).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Mode frequencies y min").fill("0");
  await page.getByLabel("Mode frequencies y max").fill("100");
  await expect(page.getByTestId("frequency-mode-plot-axis-message")).toHaveCount(0);
  await fixedAxisButton.click();
  await expect(fixedAxisButton).toHaveAttribute("aria-pressed", "true");

  const hoveredChartPoint = chart.locator(".analysis-chart-point").first();
  await hoveredChartPoint.hover({ force: true });
  const chartTooltip = page.getByTestId("frequency-mode-plot-tooltip");
  await expect(chartTooltip).toBeVisible();
  const hoveredPointBox = await hoveredChartPoint.boundingBox();
  const tooltipBox = await chartTooltip.boundingBox();
  if (!hoveredPointBox || !tooltipBox) {
    throw new Error("Expected hovered chart point and tooltip boxes.");
  }
  expect(Math.abs(tooltipBox.x - hoveredPointBox.x)).toBeLessThan(220);
  expect(Math.abs(tooltipBox.y - hoveredPointBox.y)).toBeLessThan(140);

  await expect(resetButton).toBeDisabled();
  const plotArea = page.getByTestId("frequency-mode-plot-plot-area");
  await plotArea.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: -120,
  });
  await expect(resetButton).toBeDisabled();
  await plotArea.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    deltaY: -120,
  });
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(resetButton).toBeDisabled();

  await page.getByTestId("frequency-mode-plot-zoom-in").click();
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(resetButton).toBeDisabled();

  await expectChartRegionZoom(page, "frequency-mode-plot");

  const plotBox = await plotArea.boundingBox();
  if (!plotBox) {
    throw new Error("Expected chart plot area to be available.");
  }
  await page.mouse.move(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    plotBox.x + plotBox.width / 2 + 40,
    plotBox.y + plotBox.height / 2 + 20,
  );
  await page.mouse.up();
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
}

export async function expectChartRegionZoom(page: Page, testId: string) {
  const boxZoomButton = page.getByTestId(`${testId}-box-zoom`);
  const resetButton = page.getByTestId(`${testId}-reset-view`);
  const plotArea = page.getByTestId(`${testId}-plot-area`);
  const plotBox = await plotArea.boundingBox();
  if (!plotBox) {
    throw new Error(`Expected ${testId} plot area to be available.`);
  }

  await expect(boxZoomButton).toHaveAttribute("aria-pressed", "false");
  await boxZoomButton.click();
  await expect(boxZoomButton).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(plotBox.x + plotBox.width * 0.22, plotBox.y + plotBox.height * 0.24);
  await page.mouse.down();
  await page.mouse.move(plotBox.x + plotBox.width * 0.62, plotBox.y + plotBox.height * 0.68);
  await expect(page.getByTestId(`${testId}-box-selection`)).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId(`${testId}-box-selection`)).toHaveCount(0);
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await expect(resetButton).toBeDisabled();
  await boxZoomButton.click();
  await expect(boxZoomButton).toHaveAttribute("aria-pressed", "false");
}

export async function selectAnalysisPlotTab(page: Page, name: "Frequencies" | "Phase ZPF") {
  await page.getByRole("tab", { exact: true, name }).click();
}

export async function closeOutputDrawer(page: Page) {
  if ((await page.getByTestId("output-drawer").count()) > 0) {
    await page.getByRole("button", { exact: true, name: "Close output" }).click();
  }
  await expect(page.getByTestId("output-drawer")).toHaveCount(0);
}

export async function symbolCoordinatesStayWithinHalfLength(
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

export async function expectCapacitorLeftOfInductor(symbol: Locator) {
  const centers = await symbol.evaluate((element) => {
    const plates = Array.from(
      element.querySelectorAll('[data-component-part="capacitor-plate"]'),
    );
    const coil = element.querySelector('[data-component-part="inductor-coil"]');
    if (plates.length !== 2 || !coil) {
      throw new Error("Expected capacitor plates and inductor coil.");
    }
    const capacitorX =
      plates
        .map((plate) => {
          const box = plate.getBoundingClientRect();
          return box.left + box.width / 2;
        })
        .reduce((sum, centerX) => sum + centerX, 0) / plates.length;
    const coilBox = coil.getBoundingClientRect();
    return {
      capacitorX,
      inductorX: coilBox.left + coilBox.width / 2,
    };
  });
  expect(centers.capacitorX).toBeLessThan(centers.inductorX);
}

export async function capacitorPlateHeight(symbol: Locator) {
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

export function parseViewBox(value: string | null) {
  if (!value) {
    throw new Error("Missing viewBox value.");
  }
  const [x, y, width, height] = value.split(" ").map(Number);
  return { x, y, width, height };
}

export async function waitForViewBox(
  canvas: Locator,
  predicate: (viewBox: ReturnType<typeof parseViewBox>) => boolean,
) {
  await expect.poll(async () => {
    const viewBox = parseViewBox(await canvas.getAttribute("viewBox"));
    return predicate(viewBox);
  }).toBe(true);
  return parseViewBox(await canvas.getAttribute("viewBox"));
}

export async function expectGridCoversView(
  grid: Locator,
  viewBox: ReturnType<typeof parseViewBox>,
) {
  const rect = await parseSvgRect(grid);
  expect(rect.x).toBeLessThanOrEqual(viewBox.x);
  expect(rect.y).toBeLessThanOrEqual(viewBox.y);
  expect(rect.x + rect.width).toBeGreaterThanOrEqual(viewBox.x + viewBox.width);
  expect(rect.y + rect.height).toBeGreaterThanOrEqual(viewBox.y + viewBox.height);
}

export async function parseSvgRect(locator: Locator) {
  return {
    x: await numberAttribute(locator, "x"),
    y: await numberAttribute(locator, "y"),
    width: await numberAttribute(locator, "width"),
    height: await numberAttribute(locator, "height"),
  };
}

export async function parseSvgCircleCenter(locator: Locator) {
  return {
    x: await numberAttribute(locator, "cx"),
    y: await numberAttribute(locator, "cy"),
  };
}

export async function parseSvgLine(locator: Locator) {
  return {
    x1: await numberAttribute(locator, "x1"),
    y1: await numberAttribute(locator, "y1"),
    x2: await numberAttribute(locator, "x2"),
    y2: await numberAttribute(locator, "y2"),
  };
}

export async function expectInlineEditorCenteredOnEdge(
  page: Page,
  edgeTestId: string,
  editor: Locator,
) {
  const edgeBox = await page.getByTestId(edgeTestId).boundingBox();
  const editorBox = await editor.boundingBox();
  if (!edgeBox || !editorBox) {
    throw new Error("Expected edge and inline editor boxes to be available.");
  }

  const edgeCenterX = edgeBox.x + edgeBox.width / 2;
  const editorCenterX = editorBox.x + editorBox.width / 2;
  expect(Math.abs(editorCenterX - edgeCenterX)).toBeLessThan(2);
}

export async function parseSvgRotation(locator: Locator) {
  const transform = await locator.getAttribute("transform");
  const match = transform?.match(/rotate\((-?\d+(?:\.\d+)?)\)/);
  if (!match) {
    throw new Error(`Missing rotate transform: ${transform}`);
  }
  return Number(match[1]);
}

export async function numberAttribute(locator: Locator, name: string) {
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

export function viewCenterX(viewBox: { x: number; width: number }) {
  return viewBox.x + viewBox.width / 2;
}

export function viewCenterY(viewBox: { y: number; height: number }) {
  return viewBox.y + viewBox.height / 2;
}

export async function expectBeforeUnloadProtection(page: Page, expected: boolean) {
  await expect.poll(() => hasBeforeUnloadProtection(page)).toBe(expected);
}

export async function hasBeforeUnloadProtection(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const wasAllowed = window.dispatchEvent(event);
    return !wasAllowed || event.defaultPrevented;
  });
}

