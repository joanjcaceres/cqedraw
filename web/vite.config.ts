import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
