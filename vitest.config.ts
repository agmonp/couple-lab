import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "electron/**/*.test.mjs"],
    exclude: ["node_modules/**", "sites-app/**", "adam-porat-graduation-animation/**"]
  }
});
