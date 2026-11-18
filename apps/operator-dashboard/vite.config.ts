import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@contracts": here("../../shared/generated/typescript/contracts.ts"),
      "@schemas": here("../../shared/schemas"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // The big libraries change rarely: own chunks download in parallel and stay cached across app deploys.
        codeSplitting: {
          groups: [
            { name: "maplibre", test: /node_modules[\\/]maplibre-gl/ },
            { name: "three", test: /node_modules[\\/]three/ },
            { name: "vendor", test: /node_modules/ },
          ],
        },
      },
    },
  },
  server: {
    fs: { allow: [here("."), here("../../shared")] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
