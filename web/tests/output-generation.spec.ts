import { Buffer } from "node:buffer";

import { expect, test } from "./fixtures";
import { dismissTutorialPromptIfVisible } from "./helpers";

test("shows an explicit loading state while first Output generation warms up", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__CQEDRAW_GENERATE_DELAY_MS__ = 1_500;
  });
  await page.goto("/");
  await dismissTutorialPromptIfVisible(page);

  const canvas = page.getByTestId("canvas");
  await canvas.click({ position: { x: 220, y: 240 } });

  await page.getByRole("button", { exact: true, name: "Output" }).click();

  const loadingState = page.getByTestId("output-generation-state");
  await expect(loadingState).toBeVisible();
  await expect(loadingState).toContainText("Starting Python engine");
  await expect(loadingState).toContainText(
    "Loading the Python backend and preparing matrices.",
  );
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toBeDisabled();
  await expect(page.getByTestId("parameter-empty")).toContainText(
    "Loading the Python backend and preparing matrices.",
  );
  await expect(page.getByTestId("output-results-placeholder")).toContainText(
    "Analysis results will appear here once matrices are ready.",
  );

  await expect(page.getByTestId("output-status")).toContainText("Generated 1 x 1", {
    timeout: 60_000,
  });
  await expect(loadingState).toHaveCount(0);
});

test("shows empty and failed Output states inside the drawer", async ({ page }) => {
  await page.goto("/");
  await dismissTutorialPromptIfVisible(page);

  await page.getByRole("button", { exact: true, name: "Output" }).click();
  await expect(page.getByTestId("output-generation-state")).toContainText(
    "No project content",
  );
  await expect(
    page.getByRole("button", { exact: true, name: "Copy matrices" }),
  ).toBeDisabled();
  await expect(page.getByTestId("parameter-empty")).toContainText(
    "Add nodes or edges before preparing matrices.",
  );

  await page.addInitScript(() => {
    window.__CQEDRAW_GENERATE_FAILURE_MESSAGE__ = "Simulated backend failure";
  });
  await page.reload();
  await dismissTutorialPromptIfVisible(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "single-node-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 2,
        state: {
          edge_counter: 0,
          node_counter: 1,
          nodes: [{ identifier: 0, name: "N1", x: 220, y: 240 }],
          edges: [],
        },
      }),
    ),
  });

  await page.getByRole("button", { exact: true, name: "Output" }).click();
  await expect(page.getByTestId("output-generation-error")).toContainText(
    "Simulated backend failure",
  );
  await expect(page.getByTestId("parameter-empty")).toContainText(
    "Simulated backend failure",
  );
});
