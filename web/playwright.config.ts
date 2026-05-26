import { defineConfig, devices } from "@playwright/test";

const e2ePort = 4173;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Two local workers keep feedback fast; CI runs serially to avoid Chromium
  // headless GPU-process crashes seen on GitHub's Ubuntu image.
  workers: isCi ? 1 : 2,
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
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: isCi ? ["--disable-gpu", "--disable-software-rasterizer"] : [],
        },
      },
    },
  ],
  webServer: {
    command: isCi
      ? `npm run preview -- --port ${e2ePort}`
      : `npm run build && npm run preview -- --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
