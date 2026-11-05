import { defineConfig } from "vitest/config";

// The first test in each worker migrates a template database (src/test/db.ts).
export default defineConfig({
  test: { testTimeout: 20_000, hookTimeout: 30_000 },
});
