import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["src/integration/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
