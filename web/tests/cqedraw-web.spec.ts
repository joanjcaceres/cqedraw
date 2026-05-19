import { expect, test } from "@playwright/test";

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

  await page.getByRole("button", { name: "Copy" }).click();
  await expect(page.getByTestId("output-status")).toContainText("Snippet copied.");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Tutorial complete");
  await expect(page.getByTestId("tutorial-callout")).toContainText("Save and Load");

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("tutorial-callout")).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("tutorial-prompt")).toBeHidden();
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
