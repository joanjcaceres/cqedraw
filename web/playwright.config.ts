import { defineConfig, devices } from "@playwright/test";

const e2ePort = 4173;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Two workers improved runtime without the Pyodide contention observed at three.
  workers: 2,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.CI
      ? `npm run preview -- --port ${e2ePort}`
      : `npm run build && npm run preview -- --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
