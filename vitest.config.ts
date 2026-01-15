import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.spec.{js,ts}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["index.js", "titan/**/*.js"],
      exclude: ["tests/**", "node_modules/**"],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});