import { expect, test as base } from "@playwright/test";

declare global {
  interface Window {
    __CQEDRAW_GENERATE_DELAY_MS__?: number;
    __CQEDRAW_GENERATE_FAILURE_MESSAGE__?: string;
    __CQEDRAW_SKIP_ENGINE_WARMUP__?: boolean;
  }
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // Engine-backed tests still load Pyodide on demand; lightweight tests skip
    // eager warmup so the shared CI browser does not accumulate runtimes.
    await page.addInitScript(() => {
      window.__CQEDRAW_SKIP_ENGINE_WARMUP__ = true;
    });
    await use(page);
  },
});

export { expect };
