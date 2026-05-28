import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const pythonPackageRoot = fileURLToPath(new URL("../cqedraw", import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    fs: {
      allow: [webRoot, pythonPackageRoot],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
