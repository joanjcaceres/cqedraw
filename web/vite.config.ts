import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    fs: {
      allow: [fileURLToPath(new URL("../cqedraw", import.meta.url))],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
