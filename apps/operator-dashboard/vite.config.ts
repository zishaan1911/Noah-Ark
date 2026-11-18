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
  server: {
    fs: { allow: [here("."), here("../../shared")] },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
