import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const PIPELINE_DATA = resolve(__dirname, "../../packages/pipeline/data");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ["gpu.server", "localhost", ".local"],
    fs: {
      allow: [resolve(__dirname), PIPELINE_DATA],
    },
  },
  resolve: {
    alias: {
      "@data": PIPELINE_DATA,
    },
  },
});
