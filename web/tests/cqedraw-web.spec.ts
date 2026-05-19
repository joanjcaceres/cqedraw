import { expect, test } from "@playwright/test";

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

test("sample project exercises the Pyodide worker bridge", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Sample" }).click();
  await page.getByRole("button", { name: "Generate" }).click();

  await expect(page.getByTestId("output-status")).toContainText("Generated 3 x 3");
  await expect(page.getByTestId("c-entries")).toContainText("C_alpha + C_beta");
  await expect(page.getByTestId("l-entries")).toContainText(
    "L_alpha_inv + L_beta_inv",
  );
});
